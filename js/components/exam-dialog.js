// "Lägg till prov": everything the app needs to know about one test, asked when it is made —
// the subject and the day, exactly which of your sets are on it (none ticked to begin with; nothing
// is assumed from the subject), optionally material of your own for this test (turned into a set
// that belongs to it), and a short note. Saving makes a test record (store.addExam / updateExam,
// lib/exam.js); the exam-prep plan, the home countdown and the reminders all read it from there.

import { store } from "../store.js";
import { el, icon, ICONS, toast, uid } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { datePicker } from "./calendar.js";
import { localDayKey } from "../lib/activity.js";
import { isHpSetId } from "../lib/hp.js";
import { EXAM_TITLE_MAX, EXAM_NOTE_MAX } from "../lib/exam.js";
import { generateAssignment, ClaudeError } from "../claude.js";
import { fitText } from "../material.js";

let dialogEl = null;
let returnFocus = null;
function onEsc(e) { if (e.key === "Escape") closeExamDialog(); }

export function closeExamDialog() {
  if (!dialogEl) return;
  dialogEl.remove();
  dialogEl = null;
  document.removeEventListener("keydown", onEsc);
  if (returnFocus?.isConnected) returnFocus.focus();
  returnFocus = null;
}

/** The sets a test in this subject can cover: the ordinary (non-HP) ones. */
const setsOf = (subjectId) => store.assignments.filter((a) => a.subjectId === subjectId && !isHpSetId(a.id));

/** Subjects a test can be in: the ones with at least one such set — a test covers sets, so a subject
 *  with none can't have one until something is added (from the library, or as material in this dialog). */
const testSubjects = () => store.subjects.filter((s) => setsOf(s.id).length);

/** Rough size of the material box and of what comes out of it. */
const MATERIAL_MIN = 40;
const MATERIAL_QUESTIONS = 10;

/**
 * @param examId     edit this test; omit to make a new one
 * @param subjectId  the subject for a new test (otherwise the first one that can have a test)
 * @param date,title,note,setIds   starting values for a new test (e.g. from a set the student marked as a test)
 * @param onSaved    called with the saved test, or with null after a delete
 */
export function openExamDialog({
  examId = null, subjectId = null, date = "", title = "", note = "", setIds = [], onSaved, _focusBack = null,
} = {}) {
  closeExamDialog();
  returnFocus = _focusBack || document.activeElement;
  const editing = examId ? store.getExam(examId) : null;
  if (examId && !editing) return;

  const choosable = testSubjects();
  const subject = store.subjects.find((s) => s.id === (editing?.subjectId || subjectId))
    || choosable[0] || null;
  if (!subject) return;
  const today = localDayKey();

  const picked = new Set(editing ? editing.setIds : setIds);
  const picker = datePicker({ value: editing?.date || date, min: today });
  const err = el("p.exam-dlg__err", { role: "alert" });
  const titleInput = el("input", {
    type: "text", maxlength: String(EXAM_TITLE_MAX), value: editing?.title ?? title,
    placeholder: t("examdlg.namePlaceholder"), "aria-label": t("examdlg.name"),
  });
  const noteInput = el("textarea", {
    rows: "2", maxlength: String(EXAM_NOTE_MAX), placeholder: t("examdlg.notePlaceholder"), "aria-label": t("examdlg.note"),
  });
  noteInput.value = editing?.note ?? note;

  /* ---- the sets on the test ---- */
  const setsBox = el("div.exam-dlg__sets");
  const allBtn = el("button.linkbtn.exam-dlg__all", { type: "button" });
  function paintSets() {
    const sets = setsOf(subject.id);
    setsBox.replaceChildren(...(sets.length
      ? sets.map((a) => {
        const id = `exam-set-${a.id}`;
        return el("label.exam-dlg__set", { for: id }, [
          el("input", {
            type: "checkbox", id, checked: picked.has(a.id),
            onchange: (e) => { if (e.target.checked) picked.add(a.id); else picked.delete(a.id); err.textContent = ""; syncAll(); },
          }),
          el("span", {}, a.title),
          el("span.exam-dlg__n", {}, t("examdlg.qCount", { n: a.questions?.length || 0 })),
        ]);
      })
      : [el("p.note", { style: { margin: "4px 10px" } }, t("examdlg.noSets"))]));
    allBtn.hidden = sets.length < 2;
    syncAll();
  }
  function syncAll() {
    const sets = setsOf(subject.id);
    allBtn.textContent = t(sets.every((a) => picked.has(a.id)) ? "examdlg.none" : "examdlg.all");
  }
  allBtn.onclick = () => {
    const sets = setsOf(subject.id);
    const on = !sets.every((a) => picked.has(a.id));
    for (const a of sets) { if (on) picked.add(a.id); else picked.delete(a.id); }
    err.textContent = "";
    paintSets();
  };

  /* ---- material of your own for this test ---- */
  const materialInput = el("textarea", { rows: "4", placeholder: t("examdlg.materialPlaceholder"), "aria-label": t("examdlg.materialHead") });
  const materialErr = el("p.exam-dlg__err", { role: "alert" });
  const buildBtn = el("button.btn.btn--ghost.btn--sm", { type: "button", disabled: !store.hasKey(), onclick: buildMaterial }, [icon(ICONS.spark, 15), t("examdlg.materialBtn")]);
  let building = false;
  async function buildMaterial() {
    const text = materialInput.value.trim();
    materialErr.textContent = "";
    if (text.length < MATERIAL_MIN) { materialErr.textContent = t("examdlg.materialShort"); materialInput.focus(); return; }
    if (building) return;
    building = true; buildBtn.disabled = true; buildBtn.lastChild.textContent = t("examdlg.materialBusy");
    try {
      const doc = await generateAssignment({ material: fitText(text), count: MATERIAL_QUESTIONS });
      if (!dialogEl) return;   // closed while it ran: the questions are dropped with the dialog
      const name = titleInput.value.trim() || subject.name;
      const a = store.addAssignmentDoc({
        ...doc,
        subject: subject.name,
        type: "assignment",
        title: t("examdlg.materialTitle", { name }),
        questions: doc.questions.map((q) => ({ ...q, id: uid() })),
      });
      picked.add(a.id);
      materialInput.value = "";
      paintSets();
      toast(t("examdlg.materialDone", { n: a.questions.length }));
    } catch (e) {
      materialErr.textContent = e instanceof ClaudeError ? e.message : t("create.genFailed");
    } finally {
      building = false; buildBtn.disabled = !store.hasKey();
      buildBtn.lastChild.textContent = t("examdlg.materialBtn");
    }
  }

  /* ---- save / delete ---- */
  function save() {
    const when = picker.getValue();
    if (!when) { err.textContent = t("examdlg.needDate"); return; }
    if (!picked.size) { err.textContent = t("examdlg.needSets"); return; }
    const fields = { subjectId: subject.id, date: when, title: titleInput.value, note: noteInput.value, setIds: [...picked] };
    const rec = editing ? store.updateExam(editing.id, fields) : store.addExam(fields);
    if (!rec) { err.textContent = t("login.somethingWrong"); return; }
    toast(t(editing ? "examdlg.updated" : "examdlg.added"));
    closeExamDialog();
    onSaved?.(rec);
  }

  function remove() {
    const rec = store.removeExam(editing.id);
    toast(t("examdlg.removed", { subject: subject.name }), {
      actionLabel: t("common.undo"),
      onAction: () => store.restoreExam(rec),
    });
    closeExamDialog();
    onSaved?.(null);
  }

  // Switching subject rebuilds the dialog for that subject (its own sets), keeping what was typed.
  const subjectPick = !editing && choosable.length > 1 ? el("label.exam-dlg__subject", {}, [
    el("span.exam-dlg__label", {}, [icon(ICONS.book, 15), t("examdlg.subject")]),
    el("select", {
      onchange: (e) => openExamDialog({
        subjectId: e.target.value, date: picker.getValue() || "", title: titleInput.value, note: noteInput.value,
        onSaved, _focusBack: returnFocus,
      }),
    }, choosable.map((s) => el("option", { value: s.id, selected: s.id === subject.id }, s.name))),
  ]) : null;

  const titleId = "exam-dlg-title";
  dialogEl = el("div.modal", {
    role: "dialog", "aria-modal": "true", "aria-labelledby": titleId,
    onclick: (e) => { if (e.target === dialogEl) closeExamDialog(); },
  }, [
    el("div.modal__card.exam-dlg", {}, [
      el("h3", { id: titleId }, editing ? t("examdlg.editTitle", { subject: subject.name }) : t("examdlg.addTitleAny")),
      el("p.note.exam-dlg__lede", {}, t("examdlg.lede")),
      subjectPick,
      el("p.exam-dlg__label", {}, [icon(ICONS.pencil, 15), t("examdlg.name")]),
      titleInput,
      el("p.exam-dlg__label", {}, [icon(ICONS.calendar, 15), t("examdlg.when")]),
      picker.el,
      el("div.exam-dlg__label.exam-dlg__label--row", {}, [
        el("span", {}, [icon(ICONS.layers, 15), t("examdlg.what")]),
        allBtn,
      ]),
      setsBox,
      el("div.exam-dlg__material", {}, [
        el("p.exam-dlg__label", {}, [icon(ICONS.fileText, 15), t("examdlg.materialHead")]),
        el("p.note", { style: { margin: "0 0 6px" } }, store.hasKey() ? t("examdlg.materialHelp") : t("examdlg.materialNoServer")),
        materialInput,
        materialErr,
        el("div", { style: { marginTop: "8px" } }, [buildBtn]),
      ]),
      el("p.exam-dlg__label", {}, [icon(ICONS.clipboard, 15), t("examdlg.note")]),
      noteInput,
      err,
      el("div.exam-dlg__actions", {}, [
        el("button.btn.btn--sm", { type: "button", onclick: save }, [icon(ICONS.check, 15), t("examdlg.save")]),
        el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: closeExamDialog }, t("common.cancel")),
        editing ? el("button.btn.btn--ghost.btn--sm.exam-dlg__remove", { type: "button", onclick: remove }, t("examdlg.remove")) : null,
      ].filter(Boolean)),
    ]),
  ]);
  paintSets();
  document.body.appendChild(dialogEl);
  document.addEventListener("keydown", onEsc);
  // After a subject switch, stay on the subject picker; otherwise start at the name.
  ((_focusBack && subjectPick?.querySelector("select")) || titleInput).focus();
}

// "Lägg till prov": when a subject's test is and which of its sets it covers.
// Saving marks the ticked sets as a test on that day (store.setExam), and
// everything else — the exam-prep plan, the home countdown, reminders, the
// evening-before plan — reads it from there.

import { store } from "../store.js";
import { el, icon, ICONS, toast } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { datePicker } from "./calendar.js";
import { localDayKey } from "../lib/activity.js";
import { nextExam } from "../lib/exam.js";
import { isHpSetId } from "../lib/hp.js";

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

/** Subjects a test can be in: the ones with at least one ordinary (non-HP) set. */
function testSubjects() {
  return store.subjects.filter((s) => store.assignments.some((a) => a.subjectId === s.id && !isHpSetId(a.id)));
}

/**
 * @param subjectId    the subject the test is in, or null to let the student
 *                     pick it in the dialog (the exam-prep landing's "Lägg till prov")
 * @param onSaved      called with the subject id after a save or delete,
 *                     e.g. to open that subject's prep page
 * @param pickSubject  show the subject picker even when a subject is given
 */
export function openExamDialog(subjectId, { onSaved, pickSubject = false, _focusBack = null } = {}) {
  closeExamDialog();
  returnFocus = _focusBack || document.activeElement;
  const choosable = testSubjects();
  if (!subjectId) {
    // Adding a test: start on a subject that doesn't have one coming up yet, so
    // the dialog opens on a new test rather than on editing an existing one.
    const today = localDayKey();
    const free = choosable.find((s) => !nextExam(store.assignments, s.id, today));
    subjectId = (free || choosable[0])?.id || null;
    pickSubject = true;
  }
  if (!subjectId) return;
  const subject = store.subjects.find((s) => s.id === subjectId);
  const name = subject?.name || "";
  const today = localDayKey();
  const current = nextExam(store.assignments, subjectId, today);
  const sets = store.assignments.filter((a) => a.subjectId === subjectId && !isHpSetId(a.id));
  // A new test covers everything until the student says otherwise.
  const picked = new Set(current ? current.sets.map((a) => a.id) : sets.map((a) => a.id));
  const picker = datePicker({ value: current?.date || "", min: today });
  const err = el("p.exam-dlg__err", { role: "alert" });

  const boxes = sets.map((a) => el("input", {
    type: "checkbox", id: `exam-set-${a.id}`, checked: picked.has(a.id),
    onchange: (e) => {
      if (e.target.checked) picked.add(a.id); else picked.delete(a.id);
      err.textContent = "";
      syncAll();
    },
  }));
  const allBtn = el("button.linkbtn.exam-dlg__all", { type: "button", onclick: () => {
    const on = picked.size < sets.length;
    sets.forEach((a, i) => { boxes[i].checked = on; if (on) picked.add(a.id); else picked.delete(a.id); });
    err.textContent = "";
    syncAll();
  } });
  function syncAll() { allBtn.textContent = t(picked.size < sets.length ? "examdlg.all" : "examdlg.none"); }
  syncAll();

  function save() {
    const date = picker.getValue();
    if (!date) { err.textContent = t("examdlg.needDate"); return; }
    if (!picked.size) { err.textContent = t("examdlg.needSets"); return; }
    store.setExam(subjectId, date, [...picked], current?.date || null);
    toast(t(current ? "examdlg.updated" : "examdlg.added", { subject: name }));
    closeExamDialog();
    onSaved?.(subjectId);
  }

  function remove() {
    const { date, sets: was } = current;
    store.clearExam(subjectId, date);
    toast(t("examdlg.removed", { subject: name }), {
      actionLabel: t("common.undo"),
      onAction: () => store.setExam(subjectId, date, was.map((a) => a.id)),
    });
    closeExamDialog();
    onSaved?.(subjectId);
  }

  // Switching subject rebuilds the dialog for that subject (its own sets, and
  // its existing test if it has one), keeping where focus goes back to.
  const subjectPick = pickSubject && choosable.length > 1 ? el("label.exam-dlg__subject", {}, [
    el("span.exam-dlg__label", {}, [icon(ICONS.book, 15), t("examdlg.subject")]),
    el("select", {
      onchange: (e) => openExamDialog(e.target.value, { onSaved, pickSubject: true, _focusBack: returnFocus }),
    }, choosable.map((s) => el("option", { value: s.id, selected: s.id === subjectId }, s.name))),
  ]) : null;

  const titleId = "exam-dlg-title";
  dialogEl = el("div.modal", {
    role: "dialog", "aria-modal": "true", "aria-labelledby": titleId,
    onclick: (e) => { if (e.target === dialogEl) closeExamDialog(); },
  }, [
    el("div.modal__card.exam-dlg", {}, [
      el("h3", { id: titleId }, pickSubject && !current ? t("examdlg.addTitleAny") : t(current ? "examdlg.editTitle" : "examdlg.addTitle", { subject: name })),
      el("p.note.exam-dlg__lede", {}, t("examdlg.lede")),
      subjectPick,
      el("p.exam-dlg__label", {}, [icon(ICONS.calendar, 15), t("examdlg.when")]),
      picker.el,
      el("div.exam-dlg__label.exam-dlg__label--row", {}, [
        el("span", {}, [icon(ICONS.layers, 15), t("examdlg.what")]),
        sets.length > 1 ? allBtn : null,
      ].filter(Boolean)),
      el("div.exam-dlg__sets", {}, sets.map((a, i) => el("label.exam-dlg__set", { for: `exam-set-${a.id}` }, [
        boxes[i],
        el("span", {}, a.title),
        el("span.exam-dlg__n", {}, t("examdlg.qCount", { n: a.questions?.length || 0 })),
      ]))),
      err,
      el("div.exam-dlg__actions", {}, [
        el("button.btn.btn--sm", { type: "button", onclick: save }, [icon(ICONS.check, 15), t("examdlg.save")]),
        el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: closeExamDialog }, t("common.cancel")),
        current ? el("button.btn.btn--ghost.btn--sm.exam-dlg__remove", { type: "button", onclick: remove }, t("examdlg.remove")) : null,
      ].filter(Boolean)),
    ]),
  ]);
  document.body.appendChild(dialogEl);
  document.addEventListener("keydown", onEsc);
  // After a subject switch, stay on the subject picker; otherwise start at the date.
  ((_focusBack && subjectPick?.querySelector("select"))
    || picker.el.querySelector('.cal__cell[tabindex="0"]') || dialogEl.querySelector("button"))?.focus();
}

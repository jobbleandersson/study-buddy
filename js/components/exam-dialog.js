// "Lägg till prov": everything the app needs to know about one test, asked when it is made —
// the subject and the day, exactly which of your sets are on it (none ticked to begin with; nothing
// is assumed from the subject), optionally material of your own for this test (turned into a set
// that belongs to it, from the same sources as Skapa), and a short note. Saving makes a test record
// (store.addExam / updateExam, lib/exam.js); the exam-prep plan, the home countdown and the reminders
// all read it from there.

import { store } from "../store.js";
import { el, clear, icon, ICONS, toast, uid } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { datePicker } from "./calendar.js";
import { fileDrop } from "./file-drop.js";
import { subjectField } from "./subject-field.js";
import { localDayKey } from "../lib/activity.js";
import { isHpSetId } from "../lib/hp.js";
import { EXAM_TITLE_MAX, EXAM_NOTE_MAX } from "../lib/exam.js";
import { parseCards, cardsToDoc } from "../lib/import.js";
import { shrinkImage } from "../lib/photo.js";
import { generateAssignment, ClaudeError } from "../claude.js";
import { extractPdfText, extractZipText, fitText } from "../material.js";

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

/** Subjects with at least one such set: where a new test starts. */
const testSubjects = () => store.subjects.filter((s) => setsOf(s.id).length);

/** The material sources, with the same names, hints and colours as Skapa. `ai` = needs the AI server. */
const SOURCES = [
  { key: "paste", icon: "pencil", color: "#7650FF", ai: true, label: "create.optPaste", sub: "create.optPasteSub" },
  { key: "photo", icon: "camera", color: "#EE3D86", ai: true, label: "create.optPhoto", sub: "create.optPhotoSub" },
  { key: "pdf", icon: "fileText", color: "#FF7426", ai: true, label: "create.optPdf", sub: "create.optPdfSub" },
  { key: "import", icon: "clipboard", color: "#3AA4E6", ai: false, label: "create.optImport", sub: "create.optImportSub" },
  { key: "blank", icon: "plus", color: "#0FA3C2", ai: false, label: "create.optBlank", sub: "create.optBlankSub" },
];

const MATERIAL_MIN = 40;          // characters of pasted text worth building from
const MATERIAL_QUESTIONS = 10;    // what the AI is asked for

/**
 * @param examId     edit this test; omit to make a new one
 * @param subjectId  the subject for a new test (otherwise the first one with sets). It is a typed field:\n *                   any name works, and a subject with no sets yet gets its first from the material below
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

  // The subject is whatever is typed in the field. It only exists as a subject once something is
  // built or saved under it; until then its list of sets is empty.
  let subjectName = (store.subjects.find((s) => s.id === (editing?.subjectId || subjectId)) || testSubjects()[0] || store.subjects[0])?.name || "";
  const curSubject = () => store.subjects.find((s) => s.name.toLowerCase() === subjectName.trim().toLowerCase()) || null;
  const curSets = () => { const s = curSubject(); return s ? setsOf(s.id) : []; };
  const today = localDayKey();

  const picked = new Set(editing ? editing.setIds : setIds);
  const blankMade = [];               // blank sets made here, so saving can offer to open the editor
  const picker = datePicker({ value: editing?.date || date, min: today });
  const err = el("p.exam-dlg__err", { role: "alert" });
  const titleInput = el("input", {
    type: "text", maxlength: String(EXAM_TITLE_MAX), value: editing?.title ?? title,
    placeholder: t("examdlg.namePlaceholder"),
  });
  const noteInput = el("textarea", { rows: "3", maxlength: String(EXAM_NOTE_MAX), placeholder: t("examdlg.notePlaceholder") });
  noteInput.value = editing?.note ?? note;

  /* ---- the sets on the test ---- */
  const setsBox = el("div.exam-dlg__sets");
  const allBtn = el("button.linkbtn.exam-dlg__all", { type: "button" });
  function paintSets() {
    const sets = curSets();
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
    const sets = curSets();
    allBtn.textContent = t(sets.every((a) => picked.has(a.id)) ? "examdlg.none" : "examdlg.all");
  }
  allBtn.onclick = () => {
    const sets = curSets();
    const on = !sets.every((a) => picked.has(a.id));
    for (const a of sets) { if (on) picked.add(a.id); else picked.delete(a.id); }
    err.textContent = "";
    paintSets();
  };

  /** The subject field changed: keep only the ticks that belong to the subject now typed. */
  function subjectChanged(name) {
    subjectName = name;
    const here = new Set(curSets().map((a) => a.id));
    for (const id of [...picked]) if (!here.has(id)) picked.delete(id);
    err.textContent = "";
    paintSets();
  }

  /* ---- material of your own: the same sources as Skapa ---- */
  const noServer = !store.hasKey();
  const lockedTag = () => t(store.aiNeedsSignIn() ? "create.optNeedsSignIn" : store.aiBlockReason() === "quota" ? "create.optQuotaOut" : "create.optNeedsServer");
  const mat = { source: null, text: "", image: null, count: 6 };   // what the open source has so far
  const tiles = el("div.exam-src", { role: "group", "aria-label": t("examdlg.materialHead") });
  const panel = el("div.exam-dlg__srcpanel");
  let building = false;

  function paintTiles() {
    tiles.replaceChildren(...SOURCES.map((s) => el("button.exam-src__tile" + (mat.source === s.key ? ".is-on" : "") + (s.ai && noServer ? ".is-locked" : ""), {
      type: "button", style: { "--c": s.color }, "aria-pressed": String(mat.source === s.key),
      onclick: () => { mat.source = mat.source === s.key ? null : s.key; mat.text = ""; mat.image = null; paintTiles(); paintPanel(); },
    }, [
      el("span.exam-src__ic", { "aria-hidden": "true" }, icon(ICONS[s.icon], 18)),
      el("span.exam-src__text", {}, [
        el("strong", {}, t(s.label)),
        el("small", {}, s.ai && noServer ? lockedTag() : t(s.sub)),
      ]),
    ])));
  }

  /** One build button + its message line; `go` makes the doc (or throws), the rest is shared. */
  function buildRow(label, ico, go, { disabled = false } = {}) {
    const msg = el("p.exam-dlg__err", { role: "alert" });
    const btn = el("button.btn.btn--sm", { type: "button", disabled, onclick: run }, [icon(ico, 15), label]);
    async function run() {
      if (building) return;
      msg.textContent = "";
      // Before anything is spent on the AI: the set needs a subject to land in.
      if (!subjectName.trim()) { msg.textContent = t("examdlg.needSubject"); return; }
      building = true; btn.disabled = true; btn.lastChild.textContent = t("examdlg.materialBusy");
      try {
        const made = await go();
        if (!dialogEl || !made) return;   // closed while it ran, or it told the user why it didn't build
        picked.add(made.id);
        mat.source = null; mat.text = ""; mat.image = null;
        paintTiles(); paintPanel(); paintSets();
        toast(t("examdlg.materialDone", { n: made.questions.length }));
      } catch (e) {
        msg.textContent = e instanceof ClaudeError ? e.message : (e?.message || t("create.genFailed"));
      } finally {
        building = false; btn.disabled = disabled; btn.lastChild.textContent = label;
      }
    }
    return el("div.exam-dlg__build", {}, [btn, msg]);
  }

  /** Saves a built doc as a set in this subject, titled after the test. */
  function saveDoc(doc, kind) {
    if (!subjectName.trim()) throw new Error(t("examdlg.needSubject"));
    const name = titleInput.value.trim() || subjectName.trim();
    return store.addAssignmentDoc({
      ...doc,
      subject: subjectName.trim(),
      type: "assignment",
      title: t(kind === "blank" ? "examdlg.blankTitle" : "examdlg.materialTitle", { name }),
      questions: doc.questions.map((q) => ({ ...q, id: uid() })),
    });
  }

  function paintPanel() {
    clear(panel);
    if (!mat.source) return;
    const aiOff = noServer;
    const field = (label, control) => el("label.field", {}, [el("span", {}, label), control]);

    if (mat.source === "paste") {
      const ta = el("textarea", { placeholder: t("create.materialPlaceholder"), rows: "5", oninput: (e) => { mat.text = e.target.value; } });
      panel.append(
        field(t("create.material"), ta),
        buildRow(t("examdlg.materialBtn"), ICONS.spark, async () => {
          if (mat.text.trim().length < MATERIAL_MIN) { throw new Error(t("examdlg.materialShort")); }
          return saveDoc(await generateAssignment({ material: fitText(mat.text), count: MATERIAL_QUESTIONS }));
        }, { disabled: aiOff }),
      );
    }

    if (mat.source === "photo") {
      const status = el("p.note", { style: { margin: "8px 0 0" } });
      let run = 0;
      const zone = fileDrop({
        kind: "image", accept: "image/*", types: t("drop.typesImage"), camera: true, paste: true,
        onFile: async (file) => {
          const mine = ++run;
          status.className = "note"; status.textContent = t("create.reading"); mat.image = null;
          try {
            const img = await shrinkImage(file);
            if (mine !== run) return;
            mat.image = img; status.textContent = ""; zone.setThumb(img.preview);
          } catch (e) {
            if (mine !== run) return;
            status.className = "note note--warn"; status.textContent = e.message || t("create.readFail"); zone.reset();
          }
        },
        onClear: () => { run++; mat.image = null; status.textContent = ""; },
      });
      panel.append(
        el("div.field", {}, [el("span", {}, t("create.choosePhotoLabel")), zone.el]), status,
        buildRow(t("examdlg.materialBtn"), ICONS.spark, async () => {
          if (!mat.image) throw new Error(t("create.needMaterial"));
          return saveDoc(await generateAssignment({ image: { mediaType: mat.image.mediaType, data: mat.image.data }, count: MATERIAL_QUESTIONS }));
        }, { disabled: aiOff }),
      );
    }

    if (mat.source === "pdf") {
      const status = el("p.note", { style: { margin: "8px 0 0" } });
      let run = 0;
      const zone = fileDrop({
        accept: "application/pdf,.pdf,application/zip,application/x-zip-compressed,.zip", types: t("drop.typesPdf"),
        onFile: async (file) => {
          const mine = ++run;
          status.className = "note"; status.textContent = t("create.reading"); mat.text = "";
          try {
            const isZip = /\.zip$/i.test(file.name) || file.type.includes("zip");
            const text = isZip ? (await extractZipText(file)).text : await extractPdfText(file);
            if (mine !== run) return;
            mat.text = text;
            status.textContent = t("create.extracted", { n: text.length.toLocaleString(), name: file.name });
          } catch (e) {
            if (mine !== run) return;
            status.className = "note note--warn"; status.textContent = e.message || t("create.readFail"); zone.reset();
          }
        },
        onClear: () => { run++; mat.text = ""; status.textContent = ""; },
      });
      panel.append(
        el("div.field", {}, [el("span", {}, t("create.pdfOrZipFile")), zone.el]), status,
        buildRow(t("examdlg.materialBtn"), ICONS.spark, async () => {
          if (mat.text.trim().length < MATERIAL_MIN) throw new Error(t("create.needMaterial"));
          return saveDoc(await generateAssignment({ material: fitText(mat.text), count: MATERIAL_QUESTIONS }));
        }, { disabled: aiOff }),
      );
    }

    if (mat.source === "import") {
      const status = el("p.note", { style: { margin: "8px 0 0" } });
      const ta = el("textarea", { placeholder: t("create.importPlaceholder"), rows: "5", oninput: (e) => { mat.text = e.target.value; refresh(); } });
      const zone = fileDrop({
        accept: ".csv,.tsv,.txt,text/csv,text/plain", types: t("drop.typesCards"),
        onFile: async (f) => { mat.text = await f.text(); ta.value = mat.text; refresh(); },
      });
      function refresh() {
        const n = parseCards(mat.text).length;
        status.className = n ? "note" : "note note--warn";
        status.textContent = n ? t("create.importFound", { n }) : (mat.text.trim() ? t("create.importNone") : "");
      }
      panel.append(
        el("p.note", { style: { margin: "0 0 8px" } }, t("create.importHint")),
        field(t("create.importPaste"), ta),
        el("div.field", {}, [el("span", {}, t("create.importFile")), zone.el]), status,
        buildRow(t("create.importBuild"), ICONS.check, async () => {
          const cards = parseCards(mat.text);
          if (!cards.length) throw new Error(t("create.importNone"));
          return saveDoc(cardsToDoc(cards, { title: "", subject: subjectName.trim() }));
        }),
      );
    }

    if (mat.source === "blank") {
      const count = el("input", {
        type: "number", min: "3", max: "15", value: String(mat.count),
        oninput: (e) => { mat.count = Math.max(3, Math.min(15, +e.target.value || 6)); },
      });
      panel.append(
        el("p.note", { style: { margin: "0 0 8px" } }, t("create.blankHint")),
        el("div.exam-dlg__howmany", {}, [field(t("create.howMany"), count)]),
        buildRow(t("create.blankBuild"), ICONS.check, async () => {
          const { blankQuestions } = await import("../views/create.js");   // only needed here
          const a = saveDoc({ topics: ["demo"], questions: blankQuestions(mat.count) }, "blank");
          blankMade.push(a.id);
          return a;
        }),
      );
    }
  }

  /* ---- save / delete ---- */
  function save() {
    const subject = curSubject();
    if (!subjectName.trim()) { err.textContent = t("examdlg.needSubject"); return; }
    const when = picker.getValue();
    if (!when) { err.textContent = t("examdlg.needDate"); return; }
    if (!subject || !picked.size) { err.textContent = t("examdlg.needSets"); return; }
    const fields = { subjectId: subject.id, date: when, title: titleInput.value, note: noteInput.value, setIds: [...picked] };
    const rec = editing ? store.updateExam(editing.id, fields) : store.addExam(fields);
    if (!rec) { err.textContent = t("login.somethingWrong"); return; }
    // A blank set you made here still needs its questions written: offer the editor.
    const blank = blankMade.find((id) => picked.has(id) && store.getAssignment(id));
    toast(t(editing ? "examdlg.updated" : "examdlg.added"), blank
      ? { actionLabel: t("examdlg.blankEdit"), onAction: () => { location.hash = `#/edit/${blank}`; } } : undefined);
    closeExamDialog();
    onSaved?.(rec);
  }

  function remove() {
    const rec = store.removeExam(editing.id);
    toast(t("examdlg.removed", { subject: subjectName }), {
      actionLabel: t("common.undo"),
      onAction: () => store.restoreExam(rec),
    });
    closeExamDialog();
    onSaved?.(null);
  }

  const subjFld = subjectField({ value: subjectName, onChange: subjectChanged });

  const labelled = (ico, text, control) =>
    el("label.field", {}, [el("span.exam-dlg__label", {}, [icon(ico, 15), text]), control]);

  const titleId = "exam-dlg-title";
  dialogEl = el("div.modal", {
    role: "dialog", "aria-modal": "true", "aria-labelledby": titleId,
    onclick: (e) => { if (e.target === dialogEl) closeExamDialog(); },
  }, [
    el("div.modal__card.exam-dlg", {}, [
      el("h3", { id: titleId }, editing ? t("examdlg.editTitle", { subject: subjectName }) : t("examdlg.addTitleAny")),
      el("p.note.exam-dlg__lede", {}, t("examdlg.lede")),
      el("div.exam-dlg__cols", {}, [
        el("div.exam-dlg__col", {}, [
          el("div.field", {}, [el("div.exam-dlg__label", {}, [icon(ICONS.book, 15), t("examdlg.subject")]), subjFld.el]),
          labelled(ICONS.pencil, t("examdlg.name"), titleInput),
          el("div.field", {}, [
            el("div.exam-dlg__label.exam-dlg__label--row", {}, [el("span", {}, [icon(ICONS.layers, 15), t("examdlg.what")]), allBtn]),
            setsBox,
          ]),
          labelled(ICONS.clipboard, t("examdlg.note"), noteInput),
        ]),
        el("div.exam-dlg__col", {}, [
          el("div.field", {}, [
            el("div.exam-dlg__label", {}, [icon(ICONS.calendar, 15), t("examdlg.when")]),
            picker.el,
          ]),
        ]),
      ]),
      el("section.exam-dlg__material", {}, [
        el("div.exam-dlg__label", {}, [icon(ICONS.spark, 15), t("examdlg.materialHead")]),
        el("p.note", { style: { margin: "0 0 var(--s-3)" } }, t("examdlg.materialHelp")),
        tiles,
        panel,
      ]),
      err,
      el("div.exam-dlg__actions", {}, [
        el("button.btn.btn--sm", { type: "button", onclick: save }, [icon(ICONS.check, 15), t("examdlg.save")]),
        el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: closeExamDialog }, t("common.cancel")),
        editing ? el("button.btn.btn--ghost.btn--sm.exam-dlg__remove", { type: "button", onclick: remove }, t("examdlg.remove")) : null,
      ].filter(Boolean)),
    ]),
  ]);
  paintSets();
  paintTiles();
  document.body.appendChild(dialogEl);
  document.addEventListener("keydown", onEsc);
  titleInput.focus();
}

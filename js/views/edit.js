// Edit a saved set: title, subject, type, and its questions.
// Reuses the same question editor the Create flow uses.

import { store } from "../store.js";
import { el, icon, ICONS, toast } from "../lib/dom.js";
import { questionEditor } from "../components/question-editor.js";
import { t, plural } from "../lib/i18n.js";
import { localDayKey } from "../lib/activity.js";
import { datePicker } from "../components/calendar.js";

export function renderEdit(assignmentId) {
  const original = store.getAssignment(assignmentId);
  if (!original) {
    return {
      title: t("session.notFoundTitle"),
      node: el("div.empty", {}, [
        el("h2", {}, t("edit.gone")),
        el("a.btn.btn--ghost", { href: "#/", style: { marginTop: "16px" } }, t("common.backToMenu")),
      ]),
    };
  }

  // Work on a copy so Cancel really cancels.
  const draft = structuredClone(original);
  const subjectName = store.subjects.find((s) => s.id === original.subjectId)?.name || t("common.general");
  // A deadline already in the past stays editable — don't clamp to today here,
  // only when creating.
  const duePicker = datePicker({
    value: original.dueAt || "",
    min: original.dueAt && original.dueAt < localDayKey() ? original.dueAt : localDayKey(),
  });

  const titleInput = el("input", {
    type: "text", value: draft.title, "aria-label": t("create.setTitleAria"),
    oninput: (e) => { draft.title = e.target.value; },
  });
  const subjectInput = el("input", {
    type: "text", value: subjectName, list: "subject-list", "aria-label": t("create.subject"),
  });
  const typeSel = el("select", { "aria-label": t("create.type") }, [
    el("option", { value: "assignment" }, t("create.typeAssignment")),
    el("option", { value: "test" }, t("create.typeTest")),
  ]);
  typeSel.value = draft.type;

  const countNote = el("p.note");
  const editor = questionEditor(draft, {
    onChange: (n) => { countNote.textContent = plural(n, "common.questionOne", "common.questionMany"); },
  });

  function save() {
    const title = draft.title.trim();
    if (!title) { toast(t("edit.giveName")); titleInput.focus(); return; }
    const questions = editor.commit();
    if (!questions.length) { toast(t("edit.needQuestion")); return; }

    const subject = store.ensureSubject(subjectInput.value.trim() || subjectName);
    store.updateAssignment(original.id, {
      title,
      type: typeSel.value,
      subjectId: subject.id,
      dueAt: duePicker.getValue() || null,
      questions,
    });
    toast(t("edit.saved"));
    location.hash = "#/";
  }

  const node = el("div", {}, [
    el("div", { style: { display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" } }, [
      el("a.iconbtn", { href: "#/", "aria-label": t("common.cancel") }, [icon(ICONS.back, 18)]),
      el("h1", {}, t("edit.title")),
    ]),

    el("div.panel", {}, [
      el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" } }, [
        el("label.field", {}, [el("span", {}, t("create.setTitle")), titleInput]),
        el("label.field", {}, [el("span", {}, t("create.subject")), subjectInput]),
      ]),
      el("label.field", { style: { maxWidth: "260px" } }, [el("span", {}, t("create.type")), typeSel]),
      el("div.field", { style: { maxWidth: "320px", marginBottom: "0" } }, [el("span", {}, t("edit.dueDate")), duePicker.el]),
      el("datalist", { id: "subject-list" }, store.subjects.map((s) => el("option", { value: s.name }))),
      countNote,
    ]),

    editor.el,

    el("div.nav-row", {}, [
      el("a.btn.btn--ghost", { href: "#/" }, t("common.cancel")),
      el("div", { style: { display: "flex", gap: "10px" } }, [
        el("button.btn.btn--ghost", { type: "button", onclick: () => editor.addQuestion() }, t("create.addQuestion")),
        el("button.btn.btn--ok", { type: "button", onclick: save }, [icon(ICONS.check, 18), t("edit.saveChanges")]),
      ]),
    ]),
  ]);

  return { title: t("edit.pageTitle", { title: original.title }), node };
}

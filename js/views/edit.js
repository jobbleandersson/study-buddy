// Edit a saved set: title, subject, type, and its questions.
// Reuses the same question editor the Create flow uses.

import { store } from "../store.js";
import { el, icon, ICONS, toast } from "../lib/dom.js";
import { questionEditor } from "../components/question-editor.js";

export function renderEdit(assignmentId) {
  const original = store.getAssignment(assignmentId);
  if (!original) {
    return {
      title: "Not found",
      node: el("div.empty", {}, [
        el("h2", {}, "That set no longer exists"),
        el("a.btn.btn--ghost", { href: "#/", style: { marginTop: "16px" } }, "Back to menu"),
      ]),
    };
  }

  // Work on a copy so Cancel really cancels.
  const draft = structuredClone(original);
  const subjectName = store.subjects.find((s) => s.id === original.subjectId)?.name || "General";

  const titleInput = el("input", {
    type: "text", value: draft.title, "aria-label": "Set title",
    oninput: (e) => { draft.title = e.target.value; },
  });
  const subjectInput = el("input", {
    type: "text", value: subjectName, list: "subject-list", "aria-label": "Subject",
  });
  const typeSel = el("select", { "aria-label": "Type" }, [
    el("option", { value: "assignment" }, "Assignment (practice)"),
    el("option", { value: "test" }, "Test (quiz)"),
  ]);
  typeSel.value = draft.type;

  const countNote = el("p.note");
  const editor = questionEditor(draft, {
    onChange: (n) => { countNote.textContent = `${n} question${n === 1 ? "" : "s"}`; },
  });

  function save() {
    const title = draft.title.trim();
    if (!title) { toast("Give the set a name"); titleInput.focus(); return; }
    const questions = editor.commit();
    if (!questions.length) { toast("A set needs at least one question"); return; }

    const subject = store.ensureSubject(subjectInput.value.trim() || subjectName);
    store.updateAssignment(original.id, {
      title,
      type: typeSel.value,
      subjectId: subject.id,
      questions,
    });
    toast("Saved");
    location.hash = "#/";
  }

  const node = el("div", {}, [
    el("div", { style: { display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" } }, [
      el("a.iconbtn", { href: "#/", "aria-label": "Cancel" }, [icon(ICONS.back, 18)]),
      el("h1", {}, "Edit set"),
    ]),

    el("div.panel", {}, [
      el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" } }, [
        el("label.field", {}, [el("span", {}, "Title"), titleInput]),
        el("label.field", {}, [el("span", {}, "Subject"), subjectInput]),
      ]),
      el("label.field", { style: { maxWidth: "260px", marginBottom: "0" } }, [el("span", {}, "Type"), typeSel]),
      el("datalist", { id: "subject-list" }, store.subjects.map((s) => el("option", { value: s.name }))),
      countNote,
    ]),

    editor.el,

    el("div.nav-row", {}, [
      el("a.btn.btn--ghost", { href: "#/" }, "Cancel"),
      el("div", { style: { display: "flex", gap: "10px" } }, [
        el("button.btn.btn--ghost", { type: "button", onclick: () => editor.addQuestion() }, "+ question"),
        el("button.btn.btn--ok", { type: "button", onclick: save }, [icon(ICONS.check, 18), "Save changes"]),
      ]),
    ]),
  ]);

  return { title: `Edit — ${original.title}`, node };
}

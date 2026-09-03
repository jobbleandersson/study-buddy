// Edit a saved set: title, subject, type, and its questions.
// Reuses the same question editor the Create flow uses.

import { store } from "../store.js";
import { el, icon, ICONS, toast, uid } from "../lib/dom.js";
import { questionEditor } from "../components/question-editor.js";
import { generateAssignment, ClaudeError } from "../claude.js";
import { t, plural } from "../lib/i18n.js";
import { localDayKey } from "../lib/activity.js";
import { datePicker } from "../components/calendar.js";
import { subjectField } from "../components/subject-field.js";
import { homeButton } from "../components/nav.js";

export function renderEdit(assignmentId, qs) {
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
  const subjectFld = subjectField({ value: subjectName });
  const typeSel = el("select", { "aria-label": t("create.type") }, [
    el("option", { value: "assignment" }, t("create.typeAssignment")),
    el("option", { value: "test" }, t("create.typeTest")),
  ]);
  typeSel.value = draft.type;

  const countNote = el("p.note");
  const editor = questionEditor(draft, {
    onChange: (n) => { countNote.textContent = plural(n, "common.questionOne", "common.questionMany"); },
  });

  /* ---- "Add more like these" (AI) ---- */
  const moreStatus = el("p.note", { hidden: true });
  const moreBtn = el("button.btn.btn--ghost.btn--sm", {
    type: "button", disabled: !store.hasKey(),
    title: store.hasKey() ? "" : t("create.needKeyShort"),
    onclick: addMore,
  }, [icon(ICONS.spark, 16), t("edit.moreLike")]);

  async function addMore() {
    const seed = editor.commit();
    if (!seed.length) { toast(t("edit.needQuestion")); return; }
    moreBtn.disabled = true;
    moreStatus.hidden = false;
    moreStatus.className = "note";
    moreStatus.textContent = t("edit.moreWorking");
    try {
      const gen = await generateAssignment({
        count: 8,
        moreLike: { title: draft.title, subject: subjectFld.getValue() || subjectName, questions: seed },
      });
      const fresh = (gen.questions || []).map((q) => ({ ...q, id: uid() }));
      if (!fresh.length) throw new Error("empty");
      draft.questions.push(...fresh);
      editor.paint();
      moreStatus.textContent = t("edit.moreAdded", { n: fresh.length });
      toast(t("edit.moreAdded", { n: fresh.length }));
    } catch (e) {
      moreStatus.className = "note note--warn";
      moreStatus.textContent = e instanceof ClaudeError ? e.message : t("edit.moreFailed");
    } finally {
      moreBtn.disabled = !store.hasKey();
    }
  }

  function save() {
    const title = draft.title.trim();
    if (!title) { toast(t("edit.giveName")); titleInput.focus(); return; }
    const questions = editor.commit();
    if (!questions.length) { toast(t("edit.needQuestion")); return; }

    const subject = store.ensureSubject(subjectFld.getValue() || subjectName);
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
    homeButton(),
    el("h1", { style: { marginBottom: "16px" } }, t("edit.title")),

    el("div.panel", {}, [
      el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", alignItems: "start" } }, [
        el("label.field", {}, [el("span", {}, t("create.setTitle")), titleInput]),
        el("label.field", {}, [el("span", {}, t("create.subject")), subjectFld.el]),
      ]),
      el("label.field", { style: { maxWidth: "260px" } }, [el("span", {}, t("create.type")), typeSel]),
      el("div.field", { style: { maxWidth: "320px", marginBottom: "0" } }, [el("span", {}, t("edit.dueDate")), duePicker.el]),
      countNote,
    ]),

    el("div", { style: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", margin: "4px 0 12px" } }, [moreBtn, moreStatus]),

    editor.el,

    el("div.nav-row", {}, [
      el("a.btn.btn--ghost", { href: "#/" }, t("common.cancel")),
      el("div", { style: { display: "flex", gap: "10px" } }, [
        el("button.btn.btn--ghost", { type: "button", onclick: () => editor.addQuestion() }, t("create.addQuestion")),
        el("button.btn.btn--ok", { type: "button", onclick: save }, [icon(ICONS.check, 18), t("edit.saveChanges")]),
      ]),
    ]),
  ]);

  // Arrived here from the card menu's "Add more questions" shortcut.
  if (qs?.get?.("more") && store.hasKey()) setTimeout(addMore, 0);

  return { title: t("edit.pageTitle", { title: original.title }), node };
}

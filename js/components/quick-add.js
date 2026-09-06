// Quick-add dialog: tap a day in any calendar → name a set, pick
// assignment vs test and a subject, and it's created with that due date and a
// few blank starter questions. Drops you straight into the editor to fill it
// in. A lightweight front door to the Create flow for the "I have a test on
// the 14th" case — no source picker, no AI.

import { el, icon, ICONS, toast } from "../lib/dom.js";
import { store } from "../store.js";
import { t, fmtDate } from "../lib/i18n.js";
import { subjectField } from "./subject-field.js";
import { blankQuestions } from "../views/create.js";

let dialogEl = null;
function onEsc(e) { if (e.key === "Escape") close(); }

export function closeQuickAdd() {
  dialogEl?.remove();
  dialogEl = null;
  document.removeEventListener("keydown", onEsc);
}
const close = closeQuickAdd;

/** `dayKey` — "YYYY-MM-DD". `onDone(assignment)` optional. */
export function openQuickAdd(dayKey, { onDone } = {}) {
  closeQuickAdd();

  let type = "assignment";
  const titleInput = el("input", {
    type: "text", "aria-label": t("quickadd.titleLabel"),
    placeholder: t("quickadd.titlePlaceholder"),
    onkeydown: (e) => { if (e.key === "Enter") create(); },
  });

  const typeRow = el("div.quickadd__types", { role: "group", "aria-label": t("create.type") },
    [["assignment", t("create.typeAssignment")], ["test", t("create.typeTest")]].map(([val, label]) =>
      el("button.quickadd__type", {
        type: "button", "aria-pressed": String(val === type),
        onclick: (e) => {
          type = val;
          typeRow.querySelectorAll(".quickadd__type").forEach((b, i) =>
            b.setAttribute("aria-pressed", String((i === 0 ? "assignment" : "test") === val)));
          e.currentTarget.blur();
        },
      }, label)));

  // Default to the subject of the most recent set, if any — most people add a
  // run of deadlines for the same course.
  const recentSubjectId = store.assignments[0]?.subjectId;
  const subjectFld = subjectField({
    value: store.subjects.find((s) => s.id === recentSubjectId)?.name || "",
  });

  function create() {
    const title = titleInput.value.trim()
      || t(type === "test" ? "quickadd.defaultTest" : "quickadd.defaultAssignment");
    const subject = subjectFld.getValue() || t("common.general");
    const a = store.addAssignmentDoc({
      type, subject, title, dueAt: dayKey,
      questions: blankQuestions(3),
    });
    closeQuickAdd();
    toast(t("quickadd.created", { title: a.title }));
    onDone?.(a);
    location.hash = `#/edit/${a.id}`;
  }

  dialogEl = el("div.modal", {
    role: "dialog", "aria-modal": "true", "aria-label": t("quickadd.title"),
    onclick: (e) => { if (e.target === dialogEl) close(); },
  }, [
    el("div.modal__card.quickadd", {}, [
      el("h3", { style: { marginBottom: "4px" } }, t("quickadd.title")),
      el("p.note", { style: { marginBottom: "16px" } }, t("quickadd.on", { date: fmtDate(dayKey) })),
      el("label.field", {}, [el("span", {}, t("quickadd.titleLabel")), titleInput]),
      el("div.field", {}, [el("span", {}, t("create.type")), typeRow]),
      el("div.field", {}, [el("span", {}, t("create.subject")), subjectFld.el]),
      el("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "8px" } }, [
        el("button.btn.btn--sm", { type: "button", onclick: create }, [icon(ICONS.plus, 16), t("quickadd.create")]),
        el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: close }, t("common.cancel")),
      ]),
    ]),
  ]);
  document.body.appendChild(dialogEl);
  document.addEventListener("keydown", onEsc);
  titleInput.focus();
}

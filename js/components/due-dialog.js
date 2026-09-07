// The "Deadline" dialog: a date picker plus an "is this a test?" toggle.
// Shared between the home card ⋮ menu and the exam-prep page (which needs a
// way to set a test date without sending the student back to the home grid).
//
// Marking a set as a test is what unlocks its countdown line, the dated exam
// plan and the reminder notification — the library ships every set as a plain
// "assignment", so a library-first student never had a way to get there.

import { store } from "../store.js";
import { el, icon, ICONS, toast } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { datePicker } from "./calendar.js";
import { localDayKey } from "../lib/activity.js";

let dialogEl = null;
function onEsc(e) { if (e.key === "Escape") closeDueDialog(); }

export function closeDueDialog() {
  dialogEl?.remove();
  dialogEl = null;
  document.removeEventListener("keydown", onEsc);
}

/**
 * @param a         the assignment to schedule
 * @param onSaved   optional callback after a save/clear (the home menu re-renders
 *                  off the store's "change" event, so it passes nothing)
 * @param defaultTest  pre-check the "this is a test" box (exam-prep opens it
 *                     to set a *test* date specifically)
 */
export function openDueDialog(a, { onSaved, defaultTest = false } = {}) {
  closeDueDialog();
  const picker = datePicker({ value: a.dueAt || "", min: localDayKey() });
  const testToggle = el("input", {
    type: "checkbox", checked: a.type === "test" || defaultTest,
  });

  function commit() {
    const wantType = testToggle.checked ? "test" : "assignment";
    if (a.type !== wantType) store.setAssignmentType(a.id, wantType);
    closeDueDialog();
    onSaved?.();
  }
  function save() {
    const v = picker.getValue();
    if (v && !store.setDueDate(a.id, v)) { toast(t("due.invalid")); return; }
    if (!v) store.setDueDate(a.id, null);
    toast(t(v ? "due.saved" : "due.cleared"));
    commit();
  }
  function clearDate() {
    const prev = a.dueAt;
    store.setDueDate(a.id, null);
    toast(t("due.cleared"), prev ? {
      actionLabel: t("common.undo"),
      onAction: () => store.setDueDate(a.id, prev),
    } : undefined);
    commit();
  }

  dialogEl = el("div.modal", {
    role: "dialog", "aria-modal": "true", "aria-label": t("due.title"),
    onclick: (e) => { if (e.target === dialogEl) closeDueDialog(); },
  }, [
    el("div.modal__card", {}, [
      el("h3", { style: { marginBottom: "6px" } }, t("due.title")),
      el("p.note", { style: { marginBottom: "14px" } }, t("due.body", { title: a.title })),
      picker.el,
      el("label.due-dialog__test", {}, [
        testToggle,
        el("span", {}, [icon(ICONS.graduation, 15), t("due.markTest")]),
      ]),
      el("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "14px" } }, [
        el("button.btn.btn--sm", { type: "button", onclick: save }, t("due.save")),
        a.dueAt && el("button.btn.btn--ghost.btn--sm", {
          type: "button", style: { color: "var(--retry-ink)" }, onclick: clearDate,
        }, t("due.clear")),
        el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: closeDueDialog }, t("common.cancel")),
      ].filter(Boolean)),
    ]),
  ]);
  document.body.appendChild(dialogEl);
  document.addEventListener("keydown", onEsc);
  picker.el.querySelector('.cal__cell[tabindex="0"]')?.focus();
}

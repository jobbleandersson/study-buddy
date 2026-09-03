// A centred yes/no dialog — the in-app replacement for window.confirm.
//
//   if (await confirmDialog({ message, confirmLabel, danger })) { ... }
//
// `message` may hold a blank line: the first paragraph becomes the question,
// anything after it becomes a highlighted reassurance / warning note.

import { el } from "../lib/dom.js";
import { t } from "../lib/i18n.js";

export function confirmDialog({ message = "", confirmLabel, cancelLabel, danger = false } = {}) {
  return new Promise((resolve) => {
    const [body, ...noteParts] = String(message).split(/\n\n+/);
    const note = noteParts.join(" ").trim();

    let settled = false;
    function finish(value) {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve(value);
    }
    function onKey(e) {
      if (e.key === "Escape") { e.stopPropagation(); finish(false); }
      else if (e.key === "Enter") { e.stopPropagation(); finish(true); }
    }

    const confirmBtn = el("button.btn" + (danger ? ".btn--danger" : ""), {
      type: "button", onclick: () => finish(true),
    }, confirmLabel || t("common.confirm"));
    const cancelBtn = el("button.btn.btn--ghost", {
      type: "button", onclick: () => finish(false),
    }, cancelLabel || t("common.cancel"));

    const overlay = el("div.modal.confirmdlg" + (danger ? ".confirmdlg--danger" : ""), {
      role: "alertdialog", "aria-modal": "true", "aria-label": body || t("common.confirm"),
      onclick: (e) => { if (e.target === overlay) finish(false); },
    }, [
      el("div.modal__card.confirmdlg__card", {}, [
        el("p.confirmdlg__body", {}, body),
        note && el("p.confirmdlg__note", {}, note),
        el("div.confirmdlg__actions", {}, [cancelBtn, confirmBtn]),
      ].filter(Boolean)),
    ]);

    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey, true);
    confirmBtn.focus();
  });
}

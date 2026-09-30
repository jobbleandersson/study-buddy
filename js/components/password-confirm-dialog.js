// A centred "type your password to confirm" dialog — the shared shape behind disabling 2FA and
// regenerating backup codes (delete-account-dialog.js is the same pattern for account deletion,
// kept separate since that one also branches on a passwordless account typing its email instead).
//
//   const ok = await passwordConfirmDialog({
//     title: t("..."), body: t("..."), confirmLabel: t("..."),
//     submit: (password) => store.disable2fa(password),
//   });

import { el } from "../lib/dom.js";
import { t } from "../lib/i18n.js";

export function passwordConfirmDialog({ title, body, confirmLabel, submit }) {
  return new Promise((resolve) => {
    const input = el("input", { type: "password", autocomplete: "current-password", "aria-label": t("login.password") });
    const err = el("p.note.note--warn", { hidden: true, role: "alert" });
    const confirmBtn = el("button.btn", { type: "submit" }, confirmLabel);
    const cancelBtn = el("button.btn.btn--ghost", { type: "button", onclick: () => close(false) }, t("common.cancel"));

    let closed = false;
    let busy = false;
    function close(value) {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve(value);
    }
    function onKey(e) {
      if (e.key === "Escape") { e.stopPropagation(); if (!busy) close(false); }
      else if (e.key === "Tab") {
        const stops = [input, cancelBtn, confirmBtn].filter((n) => !n.disabled);
        const at = stops.indexOf(document.activeElement);
        e.preventDefault();
        stops[(at + (e.shiftKey ? -1 : 1) + stops.length) % stops.length].focus();
      }
    }

    async function onSubmit(e) {
      e.preventDefault();
      const password = input.value;
      if (!password) { err.textContent = t("login.password"); err.hidden = false; input.focus(); return; }
      busy = true;
      confirmBtn.disabled = true; cancelBtn.disabled = true; err.hidden = true;
      try {
        await submit(password);
        close(true);
      } catch (ex) {
        err.textContent = ex.message || t("login.somethingWrong");
        err.hidden = false;
        confirmBtn.disabled = false; cancelBtn.disabled = false;
        input.focus();
      } finally {
        busy = false;
      }
    }

    const overlay = el("div.modal.confirmdlg", {
      role: "alertdialog", "aria-modal": "true", "aria-label": title,
      onclick: (e) => { if (e.target === overlay && !confirmBtn.disabled) close(false); },
    }, [
      el("form.modal__card.confirmdlg__card", { onsubmit: onSubmit }, [
        el("p.confirmdlg__body", {}, title),
        el("p.confirmdlg__note", {}, body),
        el("label.field", { style: { margin: "12px 0 0" } }, [
          el("span", {}, t("login.password")),
          input,
        ]),
        err,
        el("div.confirmdlg__actions", {}, [cancelBtn, confirmBtn]),
      ]),
    ]);

    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey, true);
    input.focus();
  });
}

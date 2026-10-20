// Change the password of a signed-in account: the current one, then the new one twice. Same family as
// password-confirm-dialog.js. The server signs every other device out, so the dialog says so up front.
//
//   const changed = await changePasswordDialog();   // true once the password is changed

import { store } from "../store.js";
import { el } from "../lib/dom.js";
import { passwordField } from "./password-field.js";
import { t } from "../lib/i18n.js";

export function changePasswordDialog() {
  return new Promise((resolve) => {
    const current = el("input", { type: "password", autocomplete: "current-password", "aria-label": t("pwchange.current") });
    const next = el("input", { type: "password", autocomplete: "new-password", placeholder: t("login.passwordHint"), "aria-label": t("pwchange.new") });
    const again = el("input", { type: "password", autocomplete: "new-password", "aria-label": t("login.confirmPassword") });
    const err = el("p.note.note--warn", { hidden: true, role: "alert" });
    const confirmBtn = el("button.btn", { type: "submit" }, t("pwchange.confirm"));
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
      // Tab is kept inside the dialog, in on-screen order, by lib/modal-a11y.js. A second trap here moved focus
      // twice at the wrap and skipped the first field.
      if (e.key === "Escape") { e.stopPropagation(); if (!busy) close(false); }
    }
    const fail = (msg, focusOn) => { err.textContent = msg; err.hidden = false; focusOn?.focus(); };

    async function onSubmit(e) {
      e.preventDefault();
      if (!current.value) return fail(t("pwchange.current"), current);
      if (next.value.length < 8) return fail(t("login.passwordHint"), next);
      if (next.value !== again.value) return fail(t("login.passwordMismatch"), again);
      busy = true;
      confirmBtn.disabled = true; cancelBtn.disabled = true; err.hidden = true;
      try {
        await store.changePassword(current.value, next.value);
        close(true);
      } catch (ex) {
        fail(ex.message || t("login.somethingWrong"), current);
        confirmBtn.disabled = false; cancelBtn.disabled = false;
      } finally {
        busy = false;
      }
    }

    const overlay = el("div.modal.confirmdlg", {
      role: "alertdialog", "aria-modal": "true", "aria-label": t("pwchange.title"),
      onclick: (e) => { if (e.target === overlay && !confirmBtn.disabled) close(false); },
    }, [
      el("form.modal__card.confirmdlg__card", { onsubmit: onSubmit }, [
        el("p.confirmdlg__body", {}, t("pwchange.title")),
        el("p.confirmdlg__note", {}, t("pwchange.intro")),
        el("label.field", { style: { margin: "12px 0 0" } }, [el("span", {}, t("pwchange.current")), passwordField(current)]),
        el("label.field", {}, [el("span", {}, t("pwchange.new")), passwordField(next)]),
        el("label.field", {}, [el("span", {}, t("login.confirmPassword")), passwordField(again)]),
        err,
        el("div.confirmdlg__actions", {}, [cancelBtn, confirmBtn]),
      ]),
    ]);

    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey, true);
    current.focus();
  });
}

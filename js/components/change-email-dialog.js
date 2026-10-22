// Change the address you sign in with: the new address and the current password. The server mails a link
// to the NEW address; nothing changes until it is opened. Same family as change-password-dialog.js.
//
//   const sent = await changeEmailDialog();   // true once the link has been asked for

import { store } from "../store.js";
import { el } from "../lib/dom.js";
import { passwordField } from "./password-field.js";
import { t } from "../lib/i18n.js";
import { dialogHead, dialogFoot } from "./set-ui.js";

export function changeEmailDialog() {
  return new Promise((resolve) => {
    const next = el("input", { type: "email", autocomplete: "email", inputmode: "email", "aria-label": t("emailchange.new") });
    const password = el("input", { type: "password", autocomplete: "current-password", "aria-label": t("emailchange.password") });
    const err = el("p.note.note--warn", { hidden: true, role: "alert" });
    const confirmBtn = el("button.btn", { type: "submit" }, t("emailchange.confirm"));
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
      const address = next.value.trim();
      if (!address.includes("@")) return fail(t("srv.err.email"), next);
      if (!password.value) return fail(t("emailchange.password"), password);
      busy = true;
      confirmBtn.disabled = true; cancelBtn.disabled = true; err.hidden = true;
      try {
        await store.changeEmail(password.value, address);
        close(true);
      } catch (ex) {
        fail(ex.message || t("login.somethingWrong"), password);
        confirmBtn.disabled = false; cancelBtn.disabled = false;
      } finally {
        busy = false;
      }
    }

    const overlay = el("div.modal.confirmdlg", {
      role: "alertdialog", "aria-modal": "true", "aria-labelledby": "emailchange-title",
      onclick: (e) => { if (e.target === overlay && !confirmBtn.disabled) close(false); },
    }, [
      el("form.modal__card.confirmdlg__card", { onsubmit: onSubmit }, [
        dialogHead({ title: t("emailchange.title"), sub: t("emailchange.intro"), id: "emailchange-title", onClose: () => { if (!busy) close(false); } }),
        el("label.field", {}, [el("span", {}, t("emailchange.new")), next]),
        el("label.field", {}, [el("span", {}, t("emailchange.password")), passwordField(password)]),
        err,
        dialogFoot([cancelBtn, confirmBtn]),
      ]),
    ]);

    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey, true);
    next.focus();
  });
}

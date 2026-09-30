// Add a password to a Google-linked account that doesn't have one yet — a two-step Promise-based
// modal, same family as twofa-setup-dialog.js. Step 1 re-proves current ownership with a *fresh*
// Google sign-in (not just the existing session — see routes/auth.js's googleIdentityMatches).
// Step 2, reached only once that credential is in hand, is the new password itself.
//
//   const added = await setPasswordDialog();   // true once the password is set

import { store } from "../store.js";
import { el } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { renderGoogleButton } from "./google-signin.js";

export function setPasswordDialog() {
  return new Promise((resolve) => {
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
    }

    const overlay = el("div.modal.confirmdlg", { role: "alertdialog", "aria-modal": "true", "aria-label": t("setpw.title") });
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey, true);
    paintConfirm();

    function paintConfirm() {
      const card = el("div.modal__card.confirmdlg__card");
      overlay.replaceChildren(card);
      card.appendChild(el("p.confirmdlg__body", {}, t("setpw.title")));
      card.appendChild(el("p.confirmdlg__note", {}, t("setpw.confirmIntro")));

      if (!store.googleClientId) {
        card.appendChild(el("p.note.note--warn", { role: "alert" }, t("setpw.googleUnavailable")));
        card.appendChild(el("div.confirmdlg__actions", {}, [
          el("button.btn.btn--ghost", { type: "button", onclick: () => close(false) }, t("common.close")),
        ]));
        return;
      }

      const googleBox = el("div.gbtn");
      const err = el("p.note.note--warn", { hidden: true, role: "alert" }, t("setpw.googleUnavailable"));
      const cancelBtn = el("button.btn.btn--ghost", { type: "button", onclick: () => close(false) }, t("common.cancel"));
      card.appendChild(googleBox);
      card.appendChild(err);
      card.appendChild(el("div.confirmdlg__actions", {}, [cancelBtn]));
      renderGoogleButton(googleBox, { clientId: store.googleClientId, mode: "signin", handler: (credential) => paintPassword(credential) })
        .then((ok) => { if (!ok) err.hidden = false; });
    }

    function paintPassword(credential) {
      const card = el("div.modal__card.confirmdlg__card");
      overlay.replaceChildren(card);

      const passwordInput = el("input", { type: "password", autocomplete: "new-password", placeholder: t("login.passwordHint"), "aria-label": t("setpw.newPassword") });
      const confirmInput = el("input", { type: "password", autocomplete: "new-password", "aria-label": t("login.confirmPassword") });
      const err = el("p.note.note--warn", { hidden: true, role: "alert" });
      const confirmBtn = el("button.btn", { type: "submit" }, t("setpw.confirm"));
      const cancelBtn = el("button.btn.btn--ghost", { type: "button", onclick: () => close(false) }, t("common.cancel"));

      async function submit(e) {
        e.preventDefault();
        const password = passwordInput.value;
        if (password.length < 8) { err.textContent = t("login.passwordHint"); err.hidden = false; return; }
        if (password !== confirmInput.value) { err.textContent = t("login.passwordMismatch"); err.hidden = false; confirmInput.focus(); return; }
        busy = true;
        confirmBtn.disabled = true; cancelBtn.disabled = true; err.hidden = true;
        try {
          await store.setPassword(credential, password);
          close(true);
        } catch (ex) {
          busy = false;
          err.textContent = ex.message || t("login.somethingWrong");
          err.hidden = false;
          confirmBtn.disabled = false; cancelBtn.disabled = false;
        }
      }

      card.appendChild(el("p.confirmdlg__body", {}, t("setpw.title")));
      card.appendChild(el("p.confirmdlg__note", {}, t("setpw.passwordIntro")));
      card.appendChild(el("form.confirmdlg__card", { onsubmit: submit }, [
        el("label.field", {}, [el("span", {}, t("setpw.newPassword")), passwordInput]),
        el("label.field", {}, [el("span", {}, t("login.confirmPassword")), confirmInput]),
        err,
        el("div.confirmdlg__actions", {}, [cancelBtn, confirmBtn]),
      ]));
      passwordInput.focus();
    }
  });
}

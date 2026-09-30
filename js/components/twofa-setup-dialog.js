// Enable two-factor authentication — a two-step Promise-based modal, same focus-trapped pattern
// as delete-account-dialog.js. Step 1 shows the secret (as text + an otpauth:// link, no QR
// library — see routes/auth.js) and takes the password + a confirming code. Step 2, reached only
// once the server has actually turned 2FA on, shows the 10 backup codes exactly once.
//
//   const enabled = await twofaSetupDialog();   // true once 2FA is on and the codes were shown

import { store } from "../store.js";
import { el, toast, icon, ICONS } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { backupCodesDialog } from "./backup-codes-dialog.js";

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast(t("common.copied")); return true; }
  catch { return false; }
}

export function twofaSetupDialog() {
  return new Promise((resolve) => {
    let closed = false;
    let busy = false;
    // Removes this dialog's own overlay without resolving — used right before opening the
    // separate backup-codes dialog, which resolves the outer promise itself once done.
    function teardown() {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
    }
    function close(value) { teardown(); resolve(value); }
    function onKey(e) {
      if (e.key === "Escape") { e.stopPropagation(); if (!busy) close(false); }
    }

    const overlay = el("div.modal.confirmdlg", { role: "alertdialog", "aria-modal": "true", "aria-label": t("twofa.setupTitle") });
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey, true);
    paintEnroll();

    async function paintEnroll() {
      const card = el("div.modal__card.confirmdlg__card");
      overlay.replaceChildren(card);
      card.appendChild(el("p.confirmdlg__body", {}, t("twofa.setupTitle")));

      let setup;
      try {
        setup = await store.setup2fa();
      } catch (ex) {
        card.appendChild(el("p.note.note--warn", { role: "alert" }, ex.message || t("login.somethingWrong")));
        card.appendChild(el("div.confirmdlg__actions", {}, [
          el("button.btn.btn--ghost", { type: "button", onclick: () => close(false) }, t("common.close")),
        ]));
        return;
      }

      card.appendChild(el("p.confirmdlg__note", {}, t("twofa.setupIntro")));

      const secretInput = el("input", { type: "text", readonly: true, value: setup.secret, "aria-label": t("twofa.secretLabel") });
      const copySecretBtn = el("button.iconbtn", { type: "button", "aria-label": t("common.copy"), onclick: async () => {
        if (!(await copyText(setup.secret))) { secretInput.focus(); secretInput.select(); }
      } }, [icon(ICONS.copy, 16)]);

      const passwordInput = el("input", { type: "password", autocomplete: "current-password", "aria-label": t("login.password") });
      const codeInput = el("input", { type: "text", autocomplete: "one-time-code", "aria-label": t("twofa.enterCode") });
      const err = el("p.note.note--warn", { hidden: true, role: "alert" });
      const confirmBtn = el("button.btn", { type: "submit" }, t("twofa.confirm"));
      const cancelBtn = el("button.btn.btn--ghost", { type: "button", onclick: () => close(false) }, t("common.cancel"));

      async function submit(e) {
        e.preventDefault();
        const password = passwordInput.value;
        const code = codeInput.value.trim();
        if (!password || !code) { err.textContent = t("login.somethingWrong"); err.hidden = false; return; }
        busy = true;
        confirmBtn.disabled = true; cancelBtn.disabled = true; err.hidden = true;
        try {
          const result = await store.confirm2fa(password, setup.secret, code);
          busy = false;
          toast(t("twofa.enabledToast"));
          teardown();   // this dialog's job is done; the backup-codes one resolves the outer promise
          await backupCodesDialog(result.backupCodes);
          resolve(true);
        } catch (ex) {
          busy = false;
          err.textContent = ex.message || t("login.somethingWrong");
          err.hidden = false;
          confirmBtn.disabled = false; cancelBtn.disabled = false;
        }
      }

      card.appendChild(el("form.confirmdlg__card", { onsubmit: submit }, [
        el("label.field", {}, [
          el("span", {}, t("twofa.secretLabel")),
          el("div.auth__control", {}, [secretInput, copySecretBtn]),
        ]),
        el("a.linkbtn", { href: setup.otpauthUri }, t("twofa.openInApp")),
        el("label.field", { style: { marginTop: "var(--s-3)" } }, [el("span", {}, t("login.password")), passwordInput]),
        el("label.field", {}, [el("span", {}, t("twofa.enterCode")), codeInput]),
        err,
        el("div.confirmdlg__actions", {}, [cancelBtn, confirmBtn]),
      ]));
      passwordInput.focus();
    }
  });
}

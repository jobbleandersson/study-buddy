// Turn on two-factor authentication — a Promise-based modal, same focus-trapped pattern as
// delete-account-dialog.js. Email is the default method (a 6-digit code mailed at sign-in: nothing to
// install); the authenticator app (a secret as text + an otpauth:// link, no QR library — see
// routes/auth.js) is the alternative. Either way the dialog ends by showing the 10 backup codes
// exactly once.
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
    let timer = null;
    // Removes this dialog's own overlay without resolving — used right before opening the
    // separate backup-codes dialog, which resolves the outer promise itself once done.
    function teardown() {
      if (closed) return;
      closed = true;
      clearInterval(timer);
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
    if (store.emailConfigured) paintEmail(); else paintTotp();

    async function finish(result) {
      toast(t("twofa.enabledToast"));
      teardown();   // this dialog's job is done; the backup-codes one resolves the outer promise
      await backupCodesDialog(result.backupCodes);
      resolve(true);
    }

    // ---- email (default) ----
    function paintEmail() {
      clearInterval(timer);
      const card = el("div.modal__card.confirmdlg__card");
      overlay.replaceChildren(card);

      const passwordInput = el("input", { type: "password", autocomplete: "current-password", "aria-label": t("login.password") });
      const codeInput = el("input", { type: "text", inputmode: "numeric", autocomplete: "one-time-code", "aria-label": t("twofa.enterEmailCode") });
      const codeRow = el("label.field", { hidden: true }, [el("span", {}, t("twofa.enterEmailCode")), codeInput]);
      const err = el("p.note.note--warn", { hidden: true, role: "alert" });
      const sendBtn = el("button.btn", { type: "submit" }, t("twofa.sendCode"));
      const cancelBtn = el("button.btn.btn--ghost", { type: "button", onclick: () => close(false) }, t("common.cancel"));
      const appLink = el("button.linkbtn", { type: "button", onclick: () => paintTotp() }, t("twofa.useApp"));
      let challenge = null;
      let left = 0;

      function paintSendLabel() {
        sendBtn.textContent = challenge === null ? t("twofa.sendCode")
          : left > 0 ? t("twofa.resendCodeWait", { n: left }) : t("twofa.resendCode");
      }
      function startCountdown(sec) {
        clearInterval(timer);
        left = Math.max(0, Math.ceil(sec || 0));
        paintSendLabel();
        if (left > 0) timer = setInterval(() => { left -= 1; paintSendLabel(); if (left <= 0) clearInterval(timer); }, 1000);
      }

      const confirmBtn = el("button.btn", { type: "button", hidden: true, onclick: confirm }, t("twofa.confirm"));
      // Enter in the code box confirms; it must not fall through to the form's submit (= re-send).
      codeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); confirm(); } });

      async function send(e) {
        e.preventDefault();
        if (challenge !== null && left > 0) return;
        if (!passwordInput.value) { err.textContent = t("login.password"); err.hidden = false; passwordInput.focus(); return; }
        busy = true; sendBtn.disabled = true; cancelBtn.disabled = true; err.hidden = true;
        try {
          const r = await store.setup2fa({ method: "email", password: passwordInput.value });
          challenge = r.challenge;
          passwordInput.disabled = true;
          codeRow.hidden = false; confirmBtn.hidden = false;
          toast(t("twofa.codeSent"));
          startCountdown(r.cooldownSec);
          codeInput.focus();
        } catch (ex) {
          if (ex.code === "twofa_cooldown") startCountdown(ex.cooldownSec);
          err.textContent = ex.message || t("login.somethingWrong");
          err.hidden = false;
        } finally {
          busy = false; cancelBtn.disabled = false;
          sendBtn.disabled = challenge !== null && left > 0;
        }
      }

      async function confirm() {
        const code = codeInput.value.trim();
        if (!code || challenge === null) { codeInput.focus(); return; }
        busy = true; confirmBtn.disabled = true; cancelBtn.disabled = true; err.hidden = true;
        try {
          finish(await store.confirm2fa({ method: "email", challenge, code }));
        } catch (ex) {
          busy = false;
          err.textContent = ex.message || t("login.somethingWrong");
          err.hidden = false;
          confirmBtn.disabled = false; cancelBtn.disabled = false;
        }
      }

      card.appendChild(el("p.confirmdlg__body", {}, t("twofa.setupTitle")));
      card.appendChild(el("p.confirmdlg__note", {}, t("twofa.emailIntro")));
      card.appendChild(el("form.confirmdlg__card", { onsubmit: send }, [
        el("label.field", {}, [el("span", {}, t("login.password")), passwordInput]),
        codeRow,
        err,
        el("div.confirmdlg__actions", {}, [cancelBtn, sendBtn, confirmBtn]),
        appLink,
      ]));
      passwordInput.focus();
    }

    // ---- authenticator app (alternative) ----
    async function paintTotp() {
      clearInterval(timer);
      const card = el("div.modal__card.confirmdlg__card");
      overlay.replaceChildren(card);
      card.appendChild(el("p.confirmdlg__body", {}, t("twofa.setupTitle")));

      let setup;
      try {
        setup = await store.setup2fa({ method: "totp" });
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
          const result = await store.confirm2fa({ method: "totp", password, secret: setup.secret, code });
          busy = false;
          finish(result);
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
        store.emailConfigured ? el("button.linkbtn", { type: "button", onclick: () => paintEmail() }, t("twofa.useEmail")) : null,
      ].filter(Boolean)));
      passwordInput.focus();
    }
  });
}

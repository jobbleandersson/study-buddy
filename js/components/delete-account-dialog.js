// "Delete my account" — a centred dialog that asks the person to prove it's them (their password,
// or their email address for a Google-linked account) before anything is erased.
//
//   const deleted = await deleteAccountDialog();   // true once the account is gone

import { store } from "../store.js";
import { el } from "../lib/dom.js";
import { t } from "../lib/i18n.js";

export function deleteAccountDialog() {
  return new Promise((resolve) => {
    const passwordless = store.authPasswordless;
    const input = el("input", passwordless
      ? { type: "email", autocomplete: "off", placeholder: store.authEmail || "", "aria-label": t("set.acctDeleteEmailLabel") }
      : { type: "password", autocomplete: "current-password", "aria-label": t("set.acctDeletePasswordLabel") });
    const err = el("p.note.note--warn", { hidden: true, role: "alert" });
    const confirmBtn = el("button.btn.btn--danger", { type: "submit" }, t("set.acctDeleteConfirm"));
    const cancelBtn = el("button.btn.btn--ghost", { type: "button", onclick: () => close(false) }, t("common.cancel"));

    let closed = false;
    let busy = false;   // the request is on its way: closing now would hide an outcome the person still needs to see
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
        // Keep focus inside the dialog.
        const stops = [input, cancelBtn, confirmBtn].filter((n) => !n.disabled);
        const at = stops.indexOf(document.activeElement);
        e.preventDefault();
        stops[(at + (e.shiftKey ? -1 : 1) + stops.length) % stops.length].focus();
      }
    }

    async function submit(e) {
      e.preventDefault();
      const value = input.value.trim();
      if (!value) { err.textContent = t(passwordless ? "set.acctDeleteEmailLabel" : "set.acctDeletePasswordLabel"); err.hidden = false; input.focus(); return; }
      busy = true;
      confirmBtn.disabled = true; cancelBtn.disabled = true; err.hidden = true;
      try {
        await store.deleteAccount(passwordless ? { email: value } : { password: value });
        close(true);
      } catch (ex) {
        err.textContent = ex.message || t("set.acctDeleteFailed");
        err.hidden = false;
        confirmBtn.disabled = false; cancelBtn.disabled = false;
        input.focus();
      } finally {
        busy = false;
      }
    }

    const overlay = el("div.modal.confirmdlg.confirmdlg--danger", {
      role: "alertdialog", "aria-modal": "true", "aria-label": t("set.acctDeleteTitle"),
      onclick: (e) => { if (e.target === overlay && !confirmBtn.disabled) close(false); },
    }, [
      el("form.modal__card.confirmdlg__card", { onsubmit: submit }, [
        el("p.confirmdlg__body", {}, t("set.acctDeleteTitle")),
        el("p.confirmdlg__note", {}, t("set.acctDeleteBody")),
        el("label.field", { style: { margin: "12px 0 0" } }, [
          el("span", {}, t(passwordless ? "set.acctDeleteEmailLabel" : "set.acctDeletePasswordLabel")),
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

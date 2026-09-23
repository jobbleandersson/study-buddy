// #/reset?token=... — the link from a "forgot password" email. Reachable signed out (that's the
// whole point); success signs the browser in with the new password.

import { store } from "../store.js";
import { el, clear, icon, ICONS, toast } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { passwordField } from "../components/password-field.js";

export function renderResetPassword(qs) {
  const token = qs?.get?.("token") || "";
  const body = el("div");

  function paintInvalid() {
    clear(body);
    body.appendChild(el("p.note.note--warn", {}, t("reset.invalidTitle")));
    body.appendChild(el("p.note", {}, t("reset.invalidBody")));
    body.appendChild(el("a.btn", { href: "#/login", style: { marginTop: "var(--s-3)" } }, t("reset.requestNew")));
  }

  function paintForm() {
    clear(body);
    const passInput = el("input", { type: "password", placeholder: "••••••••" });
    const confirmInput = el("input", { type: "password", placeholder: "••••••••", autocomplete: "new-password" });
    const errorNote = el("p.note.note--warn", { hidden: true });
    const submitBtn = el("button.btn", { type: "submit" }, t("reset.submit"));

    async function submit(e) {
      e.preventDefault();
      const password = passInput.value;
      if (!password) return;
      if (password !== confirmInput.value) {
        errorNote.textContent = t("login.passwordMismatch");
        errorNote.hidden = false;
        confirmInput.focus();
        return;
      }
      submitBtn.disabled = true;
      errorNote.hidden = true;
      try {
        await store.resetPassword(token, password);
        toast(t("reset.success"));
        location.hash = "#/settings";
      } catch (err) {
        if (err.code === "bad_token") { paintInvalid(); return; }
        errorNote.textContent = err.message || t("reset.failed");
        errorNote.hidden = false;
        submitBtn.disabled = false;
      }
    }

    body.appendChild(el("p.note", { style: { margin: "0 0 16px" } }, t("reset.body")));
    body.appendChild(el("form", { onsubmit: submit }, [
      el("label.field", {}, [el("span", {}, t("reset.newPassword")), passwordField(passInput)]),
      el("label.field", {}, [el("span", {}, t("login.confirmPassword")), passwordField(confirmInput)]),
      errorNote,
      submitBtn,
    ]));
  }

  if (token) paintForm(); else paintInvalid();

  const node = el("div.settings", {}, [
    el("h1", {}, t("reset.title")),
    el("section.panel", {}, [body]),
    el("a.btn.btn--ghost", { href: "#/login" }, [icon(ICONS.back, 16), t("login.back")]),
  ]);

  return { title: t("reset.title"), node };
}

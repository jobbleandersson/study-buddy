// #/reset?token=... — the link from a "forgot password" email. Reachable signed out (that's the
// whole point); success signs the browser in with the new password.

import { store } from "../store.js";
import { el, clear, icon, ICONS, toast } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { passwordField } from "../components/password-field.js";

// Reuses the sign-in page's field/error styling (.auth__field, .auth__control,
// .auth__error) for the same polish, without its full split-screen layout —
// same shared-card pattern as premium-waitlist.js (see .formcard in app.css).
export function renderResetPassword(qs) {
  const token = qs?.get?.("token") || "";
  const body = el("div");
  const fieldIcon = (input) => el("div.auth__control", {}, [el("span.auth__icon", { "aria-hidden": "true" }, [icon(ICONS.lock, 18)]), passwordField(input)]);

  function paintInvalid() {
    clear(body);
    body.appendChild(el("p.auth__error", {}, t("reset.invalidTitle")));
    body.appendChild(el("p.note", { style: { margin: "var(--s-3) 0 0" } }, t("reset.invalidBody")));
    body.appendChild(el("a.btn", { href: "#/login", style: { marginTop: "var(--s-4)" } }, t("reset.requestNew")));
  }

  function paintForm() {
    clear(body);
    const passInput = el("input", { type: "password", placeholder: "••••••••" });
    const confirmInput = el("input", { type: "password", placeholder: "••••••••", autocomplete: "new-password" });
    const errorNote = el("p.note.note--warn", { hidden: true });
    const submitBtn = el("button.btn", { type: "submit" }, [t("reset.submit"), icon(ICONS.arrow, 18)]);

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

    body.appendChild(el("p.formcard__lead", {}, t("reset.body")));
    body.appendChild(el("form.formcard__form", { onsubmit: submit }, [
      el("label.auth__field", {}, [el("span", {}, t("reset.newPassword")), fieldIcon(passInput)]),
      el("label.auth__field", {}, [el("span", {}, t("login.confirmPassword")), fieldIcon(confirmInput)]),
      errorNote,
      submitBtn,
    ]));
  }

  if (token) paintForm(); else paintInvalid();

  const node = el("div.settings", {}, [
    el("h1", {}, t("reset.title")),
    el("section.panel.formcard", {}, [body]),
    el("a.btn.btn--ghost", { href: "#/login" }, [icon(ICONS.back, 16), t("login.backToSignIn")]),
  ]);

  return { title: t("reset.title"), node };
}

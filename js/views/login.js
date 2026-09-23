// Sign in / create an account. Optional — Studify works fully signed out;
// this only turns on syncing the same library across devices.

import { store } from "../store.js";
import { el, toast, icon, ICONS } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { renderGoogleButton } from "../components/google-signin.js";
import { passwordField } from "../components/password-field.js";

/** Where to land after signing in. `?next=` carries a hash path, optionally with
 *  its own plain query string (e.g. from the classes hub's sign-in prompt,
 *  `?next=%23%2Fclasses%3Fcode%3DABC123`, so a join code someone shared survives
 *  the detour through sign-in) — restricted to a safe character set so it can
 *  never become an open redirect or carry anything but a plain internal route.
 *  Anything else falls back to the usual Settings landing. */
function safeNext(raw) {
  if (typeof raw !== "string" || !raw) return "#/settings";
  const hash = raw.startsWith("#") ? raw : `#${raw}`;
  return /^#\/[a-zA-Z0-9/_-]*(\?[a-zA-Z0-9_=&-]*)?$/.test(hash) ? hash : "#/settings";
}

export function renderLogin(qs) {
  const dest = safeNext(qs?.get?.("next"));
  let mode = "login"; // "login" | "signup" | "forgot" | "forgotSent"

  // No server reachable → the whole form is inert; disable it rather than let
  // someone fill it in and hit a network error.
  const serverDown = !store.proxyUp;

  const emailInput = el("input", { type: "email", autocomplete: "email", placeholder: t("login.emailPlaceholder"), disabled: serverDown });
  const passInput = el("input", { type: "password", placeholder: "••••••••", disabled: serverDown });
  const confirmInput = el("input", { type: "password", placeholder: "••••••••", disabled: serverDown, autocomplete: "new-password" });
  const errorNote = el("p.note.note--warn", { hidden: true });
  const submitBtn = el("button.btn", { type: "submit", disabled: serverDown }, t("login.signIn"));
  const toggleBtn = el("button.btn.btn--ghost.btn--sm", { type: "button" }, "");
  const forgotLink = el("button.btn.btn--ghost.btn--sm", { type: "button" }, t("login.forgotPassword"));
  const backToSignInLink = el("button.btn.btn--ghost.btn--sm", { type: "button" }, t("login.backToSignIn"));
  const forgotSentNote = el("p.note", { hidden: true }, t("login.forgotSent"));
  const introNote = el("p.note", { style: { margin: "0 0 16px" } }, t("login.intro"));

  const passRow = el("label.field", {}, [el("span", {}, t("login.password")), passwordField(passInput)]);
  const confirmRow = el("label.field", {}, [el("span", {}, t("login.confirmPassword")), passwordField(confirmInput)]);

  // Making an account needs a yes to the Terms + Privacy Policy and the age statement. The box
  // shows in sign-up mode, and for Google when the server says the sign-in would create a new account.
  const consentInput = el("input", { type: "checkbox", onchange: () => { errorNote.hidden = true; } });
  const consentRow = el("label.field.consentrow", { hidden: true }, [
    consentInput,
    el("span", {}, [
      t("login.consentLead") + " ",
      el("a", { href: "#/terms", target: "_blank", rel: "noopener" }, t("login.consentTerms")),
      " " + t("login.consentAnd") + " ",
      el("a", { href: "#/privacy", target: "_blank", rel: "noopener" }, t("login.consentPrivacy")),
      ".",
    ]),
  ]);
  let googleCredential = null;   // kept while the person ticks the box, so they needn't pick their account again
  const googleConfirmBtn = el("button.btn", { type: "button", hidden: true, onclick: () => confirmGoogle() }, t("login.googleConfirm"));

  function paintMode() {
    const forgotDone = mode === "forgotSent";
    submitBtn.textContent = mode === "forgot" ? t("login.forgotSubmit") : mode === "login" ? t("login.signIn") : t("login.createAccount");
    submitBtn.hidden = forgotDone;
    toggleBtn.hidden = mode === "forgot" || forgotDone;
    toggleBtn.textContent = mode === "login" ? t("login.needAccount") : t("login.haveAccount");
    // No reset link can be sent unless the server has email set up — showing the control anyway
    // would promise a message that never arrives (store.emailConfigured, from /api/health).
    forgotLink.hidden = mode !== "login" || !store.emailConfigured;
    backToSignInLink.hidden = mode !== "forgot" && !forgotDone;
    forgotSentNote.hidden = !forgotDone;
    introNote.hidden = mode === "forgot" || forgotDone;
    emailInput.hidden = forgotDone;
    passRow.hidden = mode === "forgot" || forgotDone;
    confirmRow.hidden = mode !== "signup";
    passInput.autocomplete = mode === "login" ? "current-password" : "new-password";
    consentRow.hidden = mode !== "signup" && !googleCredential;
    googleConfirmBtn.hidden = !googleCredential;
    passInput.placeholder = mode === "login" ? "••••••••" : t("login.passwordHint");
  }

  function setMode(next) {
    mode = next;
    errorNote.hidden = true;
    paintMode();
    paintGoogle();
  }
  toggleBtn.addEventListener("click", () => setMode(mode === "login" ? "signup" : "login"));
  forgotLink.addEventListener("click", () => setMode("forgot"));
  backToSignInLink.addEventListener("click", () => setMode("login"));

  // Google's button: only when the server has it set up. If Google's script
  // can't load (blocked, offline) the whole section stays hidden and the form
  // below works exactly as before.
  const googleBox = el("div.gbtn");
  const googleSection = el("div.login-google", { hidden: true }, [
    googleBox,
    el("div.login-or", {}, [el("span", {}, t("login.or"))]),
  ]);
  async function onGoogle(credential) {
    errorNote.hidden = true;
    try {
      const r = await store.loginWithGoogle(credential, { consent: consentInput.checked });
      googleCredential = null;
      toast(r.linked ? t("login.googleLinkedToast") : r.created ? t("login.googleCreatedToast") : t("login.signedInToast"));
      location.hash = dest;
    } catch (err) {
      if (err.code === "consent_required") {
        // A new account would be created — ask first, then let them confirm without re-picking.
        googleCredential = credential;
        paintMode();
        errorNote.textContent = t("login.googleNeedsConsent");
      } else {
        errorNote.textContent = err.message || t("login.googleFailed");
      }
      errorNote.hidden = false;
    }
  }
  async function confirmGoogle() {
    if (!googleCredential) return;
    if (!consentInput.checked) { errorNote.textContent = t("login.consentNeeded"); errorNote.hidden = false; consentInput.focus(); return; }
    await onGoogle(googleCredential);
  }
  async function paintGoogle() {
    if (serverDown || !store.googleClientId || mode === "forgot" || mode === "forgotSent") { googleSection.hidden = true; return; }
    googleSection.hidden = false;   // reserve the space first so the button can measure its width
    const ok = await renderGoogleButton(googleBox, {
      clientId: store.googleClientId,
      mode,
      handler: onGoogle,
    });
    if (!ok) googleSection.hidden = true;
  }

  async function submit(e) {
    e.preventDefault();
    const email = emailInput.value.trim();

    if (mode === "forgot") {
      if (!email) return;
      submitBtn.disabled = true;
      errorNote.hidden = true;
      try {
        await store.forgotPassword(email);
        mode = "forgotSent";
        paintMode();
      } catch (err) {
        errorNote.textContent = err.message || t("login.somethingWrong");
        errorNote.hidden = false;
      } finally {
        submitBtn.disabled = false;
      }
      return;
    }

    const password = passInput.value;
    if (!email || !password) return;
    if (mode === "signup") {
      if (password !== confirmInput.value) {
        errorNote.textContent = t("login.passwordMismatch");
        errorNote.hidden = false;
        confirmInput.focus();
        return;
      }
      if (!consentInput.checked) {
        errorNote.textContent = t("login.consentNeeded");
        errorNote.hidden = false;
        consentInput.focus();
        return;
      }
    }

    submitBtn.disabled = true;
    errorNote.hidden = true;
    try {
      if (mode === "login") {
        await store.login(email, password);
        toast(t("login.signedInToast"));
      } else {
        await store.signup(email, password, { consent: consentInput.checked });
        toast(t(store.emailConfigured && !store.authEmailVerified ? "login.createdToastUnverified" : "login.createdToast"));
      }
      location.hash = dest;
    } catch (err) {
      errorNote.textContent = err.message || t("login.somethingWrong");
      errorNote.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  }
  paintMode();

  const form = el("form", { onsubmit: submit }, [
    el("label.field", {}, [el("span", {}, t("login.email")), emailInput]),
    passRow,
    confirmRow,
    consentRow,
    el("p.field__note", { style: { margin: "-4px 0 4px" } }, [forgotLink, backToSignInLink]),
    forgotSentNote,
    errorNote,
    el("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" } }, [submitBtn, googleConfirmBtn, toggleBtn]),
  ]);

  const node = el("div.settings", {}, [
    el("h1", {}, t("login.title")),
    el("section.panel", {}, [
      introNote,
      serverDown ? el("p.note.note--warn", { style: { margin: "0 0 16px" } }, t("login.serverDown")) : null,
      googleSection,
      form,
    ].filter(Boolean)),
    el("a.btn.btn--ghost", { href: "#/settings" }, [icon(ICONS.back, 16), t("login.back")]),
  ]);
  paintGoogle();

  return { title: t("login.title"), node };
}

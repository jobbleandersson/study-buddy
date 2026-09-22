// Sign in / create an account. Optional — Studify works fully signed out;
// this only turns on syncing the same library across devices.

import { store } from "../store.js";
import { el, toast, icon, ICONS } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { renderGoogleButton } from "../components/google-signin.js";

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
  let mode = "login"; // | "signup"

  // No server reachable → the whole form is inert; disable it rather than let
  // someone fill it in and hit a network error.
  const serverDown = !store.proxyUp;

  const emailInput = el("input", { type: "email", autocomplete: "email", placeholder: t("login.emailPlaceholder"), disabled: serverDown });
  const passInput = el("input", { type: "password", placeholder: "••••••••", disabled: serverDown });
  const errorNote = el("p.note.note--warn", { hidden: true });
  const submitBtn = el("button.btn", { type: "submit", disabled: serverDown }, t("login.signIn"));
  const toggleBtn = el("button.btn.btn--ghost.btn--sm", { type: "button" }, "");

  // Making an account needs a yes to the Terms + Privacy Policy and the age statement. The box
  // shows in sign-up mode, and for Google when the server says the sign-in would create a new account.
  const consentInput = el("input", { type: "checkbox", id: "consent", onchange: () => { errorNote.hidden = true; } });
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
    submitBtn.textContent = mode === "login" ? t("login.signIn") : t("login.createAccount");
    toggleBtn.textContent = mode === "login" ? t("login.needAccount") : t("login.haveAccount");
    passInput.autocomplete = mode === "login" ? "current-password" : "new-password";
    consentRow.hidden = mode === "login" && !googleCredential;
    googleConfirmBtn.hidden = !googleCredential;
    passInput.placeholder = mode === "login" ? "••••••••" : t("login.passwordHint");
  }

  toggleBtn.addEventListener("click", () => {
    mode = mode === "login" ? "signup" : "login";
    errorNote.hidden = true;
    paintMode();
    paintGoogle();
  });

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
        // A new account would be created â ask first, then let them confirm without re-picking.
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
    if (serverDown || !store.googleClientId) return;
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
    const password = passInput.value;
    if (!email || !password) return;
    if (mode === "signup" && !consentInput.checked) {
      errorNote.textContent = t("login.consentNeeded");
      errorNote.hidden = false;
      consentInput.focus();
      return;
    }

    submitBtn.disabled = true;
    errorNote.hidden = true;
    try {
      if (mode === "login") await store.login(email, password);
      else await store.signup(email, password, { consent: consentInput.checked });
      toast(mode === "login" ? t("login.signedInToast") : t("login.createdToast"));
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
    el("label.field", {}, [el("span", {}, t("login.password")), passInput]),
    consentRow,
    errorNote,
    el("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" } }, [submitBtn, googleConfirmBtn, toggleBtn]),
  ]);

  const node = el("div.settings", {}, [
    el("h1", {}, t("login.title")),
    el("section.panel", {}, [
      el("p.note", { style: { margin: "0 0 16px" } }, t("login.intro")),
      serverDown ? el("p.note.note--warn", { style: { margin: "0 0 16px" } }, t("login.serverDown")) : null,
      googleSection,
      form,
    ].filter(Boolean)),
    el("a.btn.btn--ghost", { href: "#/settings" }, [icon(ICONS.back, 16), t("login.back")]),
  ]);
  paintGoogle();

  return { title: t("login.title"), node };
}

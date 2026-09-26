// Sign in / create an account. Optional — Studify works fully signed out;
// this only turns on syncing the same library across devices.

import { store } from "../store.js";
import { el, toast, icon, ICONS } from "../lib/dom.js";
import { t, getLang, setLang, LANGS } from "../lib/i18n.js";
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

  const emailInput = el("input", { id: "auth-email", type: "email", autocomplete: "email", required: true, placeholder: t("login.emailPlaceholder"), disabled: serverDown });
  const passInput = el("input", { id: "auth-password", type: "password", placeholder: "••••••••", disabled: serverDown });
  const confirmInput = el("input", { id: "auth-confirm", type: "password", placeholder: "••••••••", disabled: serverDown, autocomplete: "new-password" });
  const errorNote = el("p.auth__error", { hidden: true, role: "alert" });
  const submitBtn = el("button.auth__submit", { type: "submit", disabled: serverDown }, t("login.signIn"));
  const heading = el("h1.auth__title");
  const subline = el("p.auth__sub");
  const toggleBtn = el("button.auth__link", { type: "button" }, "");
  const forgotLink = el("button.auth__link.auth__forgot", { type: "button" }, t("login.forgotPassword"));
  const backToSignInLink = el("button.auth__link", { type: "button" }, [icon(ICONS.back, 15), t("login.backToSignIn")]);
  const forgotSentNote = el("p.auth__notice", { hidden: true, role: "status" }, [icon(ICONS.check, 18), el("span", {}, t("login.forgotSent"))]);
  const introNote = el("p.auth__optional", {}, t("login.optionalNote"));

  /** A labelled input with its icon inside the field, like the password eye on the right. */
  const withIcon = (ic, control) => el("div.auth__control", {}, [el("span.auth__icon", { "aria-hidden": "true" }, [icon(ic, 18)]), control]);
  const emailRow = el("label.auth__field", { for: "auth-email" }, [el("span", {}, t("login.email")), withIcon(ICONS.mail, emailInput)]);
  const passRow = el("div.auth__field", {}, [
    el("div.auth__labelrow", {}, [el("label", { for: "auth-password" }, t("login.password")), forgotLink]),
    withIcon(ICONS.lock, passwordField(passInput)),
  ]);
  const confirmRow = el("label.auth__field", { for: "auth-confirm" }, [el("span", {}, t("login.confirmPassword")), withIcon(ICONS.lock, passwordField(confirmInput))]);

  // Making an account needs a yes to the Terms + Privacy Policy and the age statement. The box
  // shows in sign-up mode, and for Google when the server says the sign-in would create a new account.
  const consentInput = el("input", { type: "checkbox", onchange: () => { errorNote.hidden = true; } });
  const consentRow = el("label.auth__consent", { hidden: true }, [
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
  const googleConfirmBtn = el("button.auth__submit", { type: "button", hidden: true, onclick: () => confirmGoogle() }, t("login.googleConfirm"));

  function paintMode() {
    const forgotDone = mode === "forgotSent";
    const forgotting = mode === "forgot" || forgotDone;
    submitBtn.replaceChildren(
      mode === "forgot" ? t("login.forgotSubmit") : mode === "login" ? t("login.signIn") : t("login.createAccount"),
      icon(ICONS.arrow, 18),
    );
    submitBtn.hidden = forgotDone;
    heading.textContent = forgotting ? t("login.forgotTitle") : mode === "login" ? t("login.welcomeBack") : t("login.createTitle");
    subline.replaceChildren(...(forgotting
      ? [t("login.forgotBody")]
      : [(mode === "login" ? t("login.noAccountYet") : t("login.alreadyHave")) + " ", toggleBtn]));
    toggleBtn.textContent = mode === "login" ? t("login.createFree") : t("login.signInLink");
    // No reset link can be sent unless the server has email set up — showing the control anyway
    // would promise a message that never arrives (store.emailConfigured, from /api/health).
    forgotLink.hidden = mode !== "login" || !store.emailConfigured;
    backToSignInLink.hidden = mode !== "forgot" && !forgotDone;
    forgotSentNote.hidden = !forgotDone;
    introNote.hidden = forgotting;
    emailRow.hidden = forgotDone;
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
  const googleBox = el("div.gbtn.auth__google");
  const googleSection = el("div", { hidden: true }, [
    googleBox,
    el("div.auth__or", {}, [el("span", {}, t("login.orEmail"))]),
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

  const form = el("form.auth__form", { onsubmit: submit, novalidate: false }, [
    emailRow,
    passRow,
    confirmRow,
    consentRow,
    forgotSentNote,
    errorNote,
    submitBtn,
    googleConfirmBtn,
    backToSignInLink,
  ]);

  const node = el("div.auth", {}, [
    el("main.auth__main", { id: "main" }, [
      el("div.auth__top", {}, [
        el("a.auth__back", { href: "#/", "aria-label": t("nav.home") }, [icon(ICONS.back, 20)]),
        langToggle(),
      ]),
      el("div.auth__card", {}, [
        el("a.auth__brand", { href: "#/" }, [el("img", { src: "assets/favicon.svg", alt: "", width: 40, height: 40 }), el("span", {}, "Studify")]),
        heading,
        subline,
        serverDown ? el("p.auth__error", {}, t("login.serverDown")) : null,
        googleSection,
        form,
        introNote,
      ].filter(Boolean)),
      el("p.auth__legal", {}, [
        el("a", { href: "#/terms" }, t("footer.terms")), " · ",
        el("a", { href: "#/privacy" }, t("footer.privacy")), " · ",
        el("a", { href: "#/" }, t("login.skip")),
      ]),
    ]),
    showcase(),
  ]);
  paintGoogle();

  return { title: t("login.title"), chrome: false, node };
}

/** The language pill in the corner, like the front page's: shows the language you're in, and
 *  switching re-renders this page in the other one. */
function langToggle() {
  const current = getLang();
  const next = LANGS.find(([c]) => c !== current);
  if (!next) return null;
  const flag = LANGS.find(([c]) => c === current)?.[2] || "";
  const hint = `${t("common.language")} → ${next[1]}`;
  return el("button.lp-lang", { type: "button", "aria-label": hint, title: hint, onclick: () => setLang(next[0]) },
    [el("span.lp-lang__flag", { "aria-hidden": "true", html: flag }), el("span", {}, current.toUpperCase())]);
}

/** The right half on wide screens: the product itself rather than a slideshow of claims — a
 *  question from the app, answered right, with the tutor's hint beside it and the note that it
 *  comes back for review. Same strings as the front page's hero card, so the two stay in step.
 *  Purely illustrative (aria-hidden) apart from the headline. Hidden on phones. */
function showcase() {
  const segs = [0, 1, 2, 3, 4].map((i) => el(i < 3 ? "i.is-done" : "i"));
  const opt = (letter, key, right) => el("div.authq__opt" + (right ? ".is-right" : ""), {}, [
    el("b", {}, letter), el("span", {}, t(key)), right ? icon(ICONS.check, 16) : null,
  ].filter(Boolean));
  return el("aside.auth__panel", {}, [
    el("div.auth__panelbrand", {}, [el("img", { src: "assets/favicon.svg", alt: "", width: 32, height: 32 }), el("span", {}, "Studify")]),
    el("div.auth__pitch", {}, [
      el("h2", {}, t("lp.title")),
      el("p", {}, t("login.panelLead")),
    ]),
    el("div.authq", { "aria-hidden": "true" }, [
      el("div.authq__card", {}, [
        el("div.authq__meta", {}, [el("b", {}, t("lp.mockSubject")), el("span", {}, t("lp.mockProgress"))]),
        el("div.authq__track", {}, segs),
        el("p.authq__prompt", {}, t("lp.mockQuestion")),
        el("div.authq__opts", {}, [opt("A", "lp.mockA"), opt("B", "lp.mockB", true), opt("C", "lp.mockC")]),
        el("p.authq__fb", {}, [icon(ICONS.spark, 14), t("lp.mockExplain")]),
      ]),
      el("div.authq__note.authq__note--hint", {}, [
        el("span.authq__noteicon", {}, [icon(ICONS.spark, 14)]),
        el("span", {}, [el("b", {}, t("lp.badgeHintLabel")), t("lp.badgeHint")]),
      ]),
      el("div.authq__note.authq__note--repeat", {}, [
        el("span.authq__noteicon", {}, [icon(ICONS.calendar, 14)]),
        el("span", {}, t("lp.badgeRepeat")),
      ]),
    ]),
    el("ul.auth__facts", {}, [
      ["lp.trust1Title", "lp.trust1Sub"], ["lp.trust2Title", "lp.trust2Sub"], ["lp.trust4Title", "lp.trust4Sub"],
    ].map(([a, b]) => el("li", {}, [el("b", {}, t(a)), el("span", {}, t(b))]))),
  ]);
}

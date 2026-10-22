// "Before you use the AI features": a one-time yes before anything is sent to Anthropic. The AI answers come
// from a third party, and both the App Store (guideline 5.1.2(i): name the third-party AI and get explicit
// permission first) and plain fairness ask for that to be said up front, not only in the privacy policy.
//
//   ensureAiConsent()   resolves true when the student has said yes (asking once if not); false = "Not now"
//   hasAiConsent()      already said yes to the current wording
//   withdrawAiConsent() from Settings; the next AI request asks again
//
// The answer is kept in settings (synced like the rest of them), stamped with AI_CONSENT_VERSION: change the
// wording in a way that matters and bump it, and everyone is asked again.

import { el } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { store } from "../store.js";
import { dialogHead, dialogFoot } from "./set-ui.js";

export const AI_CONSENT_VERSION = 1;

export function hasAiConsent() {
  const s = store.state.settings || {};
  return !!s.aiConsentAt && s.aiConsentV === AI_CONSENT_VERSION;
}

export function withdrawAiConsent() {
  store.setSettings({ aiConsentAt: null, aiConsentV: null });
}

let pending = null;   // one dialog at a time: two AI requests at once share the answer

export function ensureAiConsent() {
  if (hasAiConsent()) return Promise.resolve(true);
  if (!pending) pending = askAiConsent().finally(() => { pending = null; });
  return pending;
}

/** The dialog itself; resolves true on "Allow", false on "Not now", Escape, a click outside or leaving the page. */
export function askAiConsent() {
  return new Promise((resolve) => {
    let settled = false;
    function finish(yes) {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("hashchange", onNav);
      overlay.remove();
      if (yes) store.setSettings({ aiConsentAt: Date.now(), aiConsentV: AI_CONSENT_VERSION });
      resolve(yes);
    }
    function onNav() { finish(false); }
    function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); finish(false); } }

    const allowBtn = el("button.btn", { type: "button", onclick: () => finish(true) }, t("aiConsent.allow"));
    const laterBtn = el("button.btn.btn--ghost", { type: "button", onclick: () => finish(false) }, t("aiConsent.later"));
    const overlay = el("div.modal.confirmdlg.aiconsent", {
      role: "dialog", "aria-modal": "true", "aria-labelledby": "aiconsent-title",
      onclick: (e) => { if (e.target === overlay) finish(false); },
    }, [
      el("div.modal__card.confirmdlg__card", {}, [
        dialogHead({ title: t("aiConsent.title"), id: "aiconsent-title", onClose: () => finish(false) }),
        el("p.confirmdlg__body", {}, t("aiConsent.body")),
        el("ul.aiconsent__list", {}, [
          el("li", {}, t("aiConsent.sendWhat")),
          el("li", {}, t("aiConsent.sendTutor")),
        ]),
        el("p.aiconsent__note", {}, [
          t("aiConsent.where"), " ",
          el("a", { href: "#/privacy", onclick: () => finish(false) }, t("aiConsent.privacyLink")),
        ]),
        el("p.aiconsent__note", {}, t("aiConsent.change")),
        dialogFoot([laterBtn, allowBtn]),
      ]),
    ]);
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("hashchange", onNav);
    allowBtn.focus();
  });
}

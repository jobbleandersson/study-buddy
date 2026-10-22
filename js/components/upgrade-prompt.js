// The "you've used this month's AI allowance" prompt. Shown once, at the
// moment a request is rejected for being over budget (store.markAiQuotaExhausted
// fires sb:quotaout) — a heads-up, not a wall: everything that isn't AI keeps
// working. The upgrade button only exists when the server hands out a
// premiumUrl (PREMIUM_URL in server/.env); without one it's a plain notice.

import { el } from "../lib/dom.js";
import { store } from "../store.js";
import { t, getLang } from "../lib/i18n.js";
import { dialogHead, dialogFoot } from "./set-ui.js";

let showing = false;

export function showUpgradePrompt({ resetsAt = null } = {}) {
  if (showing) return;
  showing = true;
  const returnFocusTo = document.activeElement;
  const url = store.premiumUrl;
  const date = resetsAt
    ? new Date(resetsAt).toLocaleDateString(getLang() === "sv" ? "sv-SE" : "en-GB", { day: "numeric", month: "long" })
    : "";

  function close() {
    showing = false;
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    returnFocusTo?.focus?.();
  }
  function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); close(); } }

  // With the paid plan set up for this account the button opens the Plus page in this tab; otherwise it is the
  // old external premium link, if the server has one.
  const plusOk = !!store.billing?.canCheckout && !store.billing?.plus;
  const hasUpgrade = plusOk || !!url;
  const dismiss = el("button.btn" + (hasUpgrade ? ".btn--ghost" : ""), { type: "button", onclick: close }, t(hasUpgrade ? "upgrade.dismiss" : "upgrade.ok"));
  const cta = plusOk
    ? el("a.btn", { href: "#/plus", onclick: close }, t("upgrade.ctaPlus"))
    : url
      ? el("a.btn", { href: url, target: "_blank", rel: "noopener noreferrer", onclick: close }, t("upgrade.cta"))
      : null;

  const overlay = el("div.modal", {
    role: "dialog", "aria-modal": "true", "aria-labelledby": "upgrade-title",
    onclick: (e) => { if (e.target === overlay) close(); },
  }, [
    el("div.modal__card.upgradedlg", {}, [
      dialogHead({ title: t("upgrade.title"), id: "upgrade-title", onClose: close }),
      el("p.upgradedlg__body", {}, date ? t("upgrade.body", { date }) : t("upgrade.bodyNoDate")),
      hasUpgrade ? el("p.upgradedlg__need", {}, t("upgrade.need")) : null,
      dialogFoot([dismiss, cta].filter(Boolean)),
    ].filter(Boolean)),
  ]);

  document.body.appendChild(overlay);
  document.addEventListener("keydown", onKey, true);
  (cta || dismiss).focus();
}

export function mountUpgradePrompt() {
  window.addEventListener("sb:quotaout", (e) => showUpgradePrompt(e.detail));
}

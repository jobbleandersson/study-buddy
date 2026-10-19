// "Om det här": the short summary that comes with a set (sourceSummary), read before or during practice.
// An AI-made set gets it from the same request that wrote its questions; library sets have a human-written
// one. Opened from a set card's ⋮ menu (with a "Plugga" button) and from inside a session (without one).
//
//   hasSummary(a)            the set has a summary worth a button
//   openSummary(a, { startHref })   the dialog; startHref adds "Börja plugga"

import { el, icon, ICONS } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { markdown } from "../lib/markdown.js";

export function hasSummary(a) {
  return typeof a?.sourceSummary === "string" && a.sourceSummary.trim().length > 0;
}

export function openSummary(a, { startHref } = {}) {
  if (!hasSummary(a)) return;
  const opener = document.activeElement;
  function close() {
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("hashchange", close);
    overlay.remove();
    if (opener?.isConnected) opener.focus?.();
  }
  function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); close(); } }
  const closeBtn = el("button.btn" + (startHref ? ".btn--ghost" : ""), { type: "button", onclick: close }, t("common.close"));
  const overlay = el("div.modal.summarydlg", {
    role: "dialog", "aria-modal": "true", "aria-label": t("create.summaryLabel"),
    onclick: (e) => { if (e.target === overlay) close(); },
  }, [
    el("div.modal__card.summarydlg__card", {}, [
      el("p.summarydlg__eyebrow", {}, [icon(ICONS.fileText, 15), t("create.summaryLabel")]),
      el("h3", {}, a.title),
      el("div.summarydlg__body", { html: markdown(a.sourceSummary) }),
      el("div.summarydlg__actions", {}, [
        closeBtn,
        startHref ? el("a.btn", { href: startHref }, [icon(ICONS.play, 16), t("summary.start")]) : null,
      ].filter(Boolean)),
    ]),
  ]);
  document.body.appendChild(overlay);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("hashchange", close);
  (overlay.querySelector("a.btn") || closeBtn).focus();
}

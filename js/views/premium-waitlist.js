// "#/premium" — where PREMIUM_URL (server/.env.example) points the "See
// Premium" button in the AI-quota-exceeded prompt, and the Settings teaser
// (see set.premiumTeaser). No paid plan exists yet — this only collects an
// email against the day one does. No account needed: POSTs straight to
// /api/waitlist/premium, same pattern as login.js's own form submit.

import { el, toast } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { homeButton } from "../components/nav.js";
import { serverMessage } from "../lib/server-errors.js";
import { WAITLIST_PREMIUM_URL } from "../config.js";

export function renderPremiumWaitlist() {
  const emailInput = el("input", { type: "email", required: true, autocomplete: "email", placeholder: t("login.emailPlaceholder") });
  const errorNote = el("p.note.note--warn", { hidden: true });
  const submitBtn = el("button.btn", { type: "submit" }, t("set.premiumLink"));

  const form = el("form", { onsubmit: submit }, [
    el("label.field", {}, [el("span", {}, t("login.email")), emailInput]),
    errorNote,
    submitBtn,
  ]);

  const panel = el("section.panel", {}, [
    el("p.note", { style: { marginBottom: "16px" } }, t("premium.note")),
    form,
  ]);

  async function submit(e) {
    e.preventDefault();
    const email = emailInput.value.trim();
    if (!email) return;
    submitBtn.disabled = true;
    errorNote.hidden = true;
    try {
      const res = await fetch(WAITLIST_PREMIUM_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(serverMessage(data?.error?.message, t("login.somethingWrong")));
      panel.replaceChildren(el("p.note", {}, t("premium.done")));
      toast(t("premium.done"));
    } catch (err) {
      errorNote.textContent = err.message;
      errorNote.hidden = false;
      submitBtn.disabled = false;
    }
  }

  return {
    title: t("premium.pageTitle"),
    node: el("div.settings", {}, [
      homeButton({ grid: true }),
      el("h1", {}, t("premium.pageTitle")),
      el("p.note", { style: { marginBottom: "16px" } }, t("premium.lead")),
      panel,
      el("a.btn.btn--ghost.pageback", { href: "#/", style: { marginTop: "8px", justifySelf: "start" } }, t("common.backToMenu")),
    ]),
  };
}

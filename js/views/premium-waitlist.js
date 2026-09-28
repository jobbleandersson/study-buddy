// "#/premium" — where PREMIUM_URL (server/.env.example) points the "See
// Premium" button in the AI-quota-exceeded prompt, and the Settings teaser
// (see set.premiumTeaser). No paid plan exists yet — this only collects an
// email against the day one does. No account needed: POSTs straight to
// /api/waitlist/premium, same pattern as login.js's own form submit.

import { el, icon, ICONS, toast } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { homeButton } from "../components/nav.js";
import { serverMessage } from "../lib/server-errors.js";
import { WAITLIST_PREMIUM_URL } from "../config.js";

// Reuses the sign-in page's field/notice styling (.auth__field, .auth__control,
// .auth__notice) for the same level of polish, without its full split-screen
// layout — this is a lightweight pitch + email capture, not a sign-in flow.
export function renderPremiumWaitlist() {
  const emailInput = el("input", { type: "email", required: true, autocomplete: "email", placeholder: t("login.emailPlaceholder") });
  const errorNote = el("p.note.note--warn", { hidden: true });
  const submitBtn = el("button.btn", { type: "submit" }, [t("set.premiumLink"), icon(ICONS.arrow, 18)]);

  const form = el("form.formcard__form", { onsubmit: submit }, [
    el("label.auth__field", {}, [
      el("span", {}, t("login.email")),
      el("div.auth__control", {}, [el("span.auth__icon", { "aria-hidden": "true" }, [icon(ICONS.mail, 18)]), emailInput]),
    ]),
    errorNote,
    submitBtn,
  ]);

  const panel = el("section.panel.formcard", {}, [
    el("p.formcard__lead", {}, t("premium.lead")),
    form,
    el("p.note.formcard__fine", {}, t("premium.note")),
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
      panel.replaceChildren(el("p.auth__notice", { role: "status" }, [icon(ICONS.check, 18), el("span", {}, t("premium.done"))]));
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
      panel,
      el("a.btn.btn--ghost.pageback", { href: "#/", style: { marginTop: "8px", justifySelf: "start" } }, t("common.backToMenu")),
    ]),
  };
}

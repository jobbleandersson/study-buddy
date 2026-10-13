// "#/plus" - PluggEra Plus, the paid plan: ten times the monthly AI help for 99 kr/month. The payment itself
// happens on Stripe's own pages (Checkout to subscribe, the customer portal to manage or cancel): this
// page only asks the server for the link and sends the browser there. What counts as Plus is decided by the
// server from Stripe's webhook (server/src/billing.js), never by anything this page says - so coming back
// from Checkout just polls the status until the webhook has landed.
//
// While the server runs on a Stripe TEST key only the accounts on its tester list can subscribe (everyone
// else sees "not open yet"), and a short note says which card to use.

import { el, icon, ICONS, toast } from "../lib/dom.js";
import { t, getLang } from "../lib/i18n.js";
import { store } from "../store.js";
import { homeButton } from "../components/nav.js";
import { serverMessage } from "../lib/server-errors.js";
import { BILLING_CHECKOUT_URL, BILLING_PORTAL_URL } from "../config.js";

const fmtDate = (ts) => new Date(ts).toLocaleDateString(getLang() === "sv" ? "sv-SE" : "en-GB", { day: "numeric", month: "long", year: "numeric" });

export function renderPlus(qs) {
  const justPaid = qs?.get?.("paid") === "1";
  const panel = el("section.panel.formcard", {});
  const node = el("div.settings", {}, [
    homeButton({ grid: true }),
    el("h1", {}, t("plus.pageTitle")),
    panel,
    el("a.btn.btn--ghost.pageback", { href: "#/", style: { marginTop: "8px", justifySelf: "start" } }, t("common.backToMenu")),
  ]);

  /** POST to the server for a Stripe link, then leave for it. */
  async function goToStripe(url, btn, errorNote) {
    btn.disabled = true;
    errorNote.hidden = true;
    const label = btn.textContent;
    btn.textContent = t("plus.opening");
    try {
      const res = await fetch(url, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: "{}" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.url !== "string" || !/^https:\/\//.test(data.url)) {
        throw new Error(serverMessage(data?.error?.message, t("plus.error")));
      }
      window.location.assign(data.url);
    } catch (err) {
      errorNote.textContent = err.message || t("plus.error");
      errorNote.hidden = false;
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  function actionButton(label, url) {
    const errorNote = el("p.note.note--warn", { hidden: true, role: "alert" });
    const btn = el("button.btn", { type: "button" }, label);
    btn.onclick = () => goToStripe(url, btn, errorNote);
    return [errorNote, btn];
  }

  function paint() {
    const b = store.billing;
    const kids = [];

    if (!store.authed) {
      kids.push(el("p.formcard__lead", {}, t("plus.lead")), el("p.note", {}, t("plus.price")),
        el("a.btn", { href: "#/login" }, [t("plus.signIn"), icon(ICONS.arrow, 18)]));
    } else if (b?.plus) {
      kids.push(
        el("p.auth__notice", { role: "status" }, [icon(ICONS.check, 18), el("span", {}, t("plus.active"))]),
        b.renewsAt ? el("p.note", {}, t(b.cancelsAtPeriodEnd ? "plus.endsOn" : "plus.renews", { date: fmtDate(b.renewsAt) })) : null,
        ...(b.hasCustomer ? actionButton(t("plus.manage"), BILLING_PORTAL_URL) : []),
      );
    } else if (b?.canCheckout) {
      kids.push(
        justPaid ? el("p.auth__notice", { role: "status" }, [icon(ICONS.check, 18), el("span", {}, t("plus.thanks"))]) : null,
        el("p.formcard__lead", {}, t("plus.lead")),
        el("ul", { style: { listStyle: "none", padding: 0, margin: "0 0 12px", display: "grid", gap: "6px" } },
          ["plus.perkAllowance", "plus.perkTutor", "plus.perkCancel"].map((k) =>
            el("li", { style: { display: "flex", gap: "8px", alignItems: "flex-start" } }, [icon(ICONS.check, 18), el("span", {}, t(k))]))),
        el("p", { style: { fontWeight: "700", fontSize: "1.25rem", margin: "4px 0" } }, t("plus.price")),
        el("p.note", {}, t("plus.priceNote")),
        b.testMode ? el("p.note.note--warn", {}, t("plus.testMode")) : null,
        ...actionButton(t("plus.cta"), BILLING_CHECKOUT_URL),
      );
    } else {
      // Plus isn't open to this account (no Stripe set up, or a test-mode rollout for testers only).
      kids.push(el("p.formcard__lead", {}, t("plus.unavailable")),
        el("a.btn.btn--ghost", { href: "#/premium" }, t("set.premiumLink")));
    }
    panel.replaceChildren(...kids.filter(Boolean));
  }

  paint();
  store.refreshBilling?.().then(() => { paint(); if (justPaid && store.billing?.plus) toast(t("plus.thanksDone")); });

  // Back from Checkout: the webhook that switches Plus on usually lands within seconds, so look again a few times.
  if (justPaid) {
    let tries = 0;
    const timer = setInterval(async () => {
      if (!node.isConnected || store.billing?.plus || ++tries > 10) { clearInterval(timer); return; }
      await store.refreshBilling();
      paint();
      if (store.billing?.plus) { toast(t("plus.thanksDone")); store.refreshUsage?.(); }
    }, 2500);
  }

  return { title: t("plus.pageTitle"), node };
}

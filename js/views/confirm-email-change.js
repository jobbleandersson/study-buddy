// #/new-email?token=... — the link mailed to the NEW address when someone asks to change the sign-in
// address. Reachable signed in or out, like the verify link.

import { store } from "../store.js";
import { el, clear, icon, ICONS } from "../lib/dom.js";
import { t } from "../lib/i18n.js";

// One request per token per page load (a language switch re-renders the route), as in verify-email.js.
const redeemed = new Map();   // token -> Promise<boolean>
function redeem(token) {
  if (!redeemed.has(token)) redeemed.set(token, store.confirmEmailChange(token).then(() => true, () => false));
  return redeemed.get(token);
}

export function renderConfirmEmailChange(qs) {
  const token = qs?.get?.("token") || "";
  const body = el("div", {}, [el("p.note", {}, t("emailchange.checking"))]);

  function paint(ok) {
    clear(body);
    if (ok) {
      body.appendChild(el("p", {}, [icon(ICONS.check, 18), " " + t("emailchange.success")]));
      body.appendChild(el("p.note", {}, t("emailchange.successBody")));
      body.appendChild(el("a.btn", { href: store.authed ? "#/settings" : "#/login", style: { marginTop: "var(--s-3)" } }, t("verify.continue")));
    } else {
      body.appendChild(el("p.note.note--warn", {}, t("emailchange.failed")));
      body.appendChild(el("p.note", {}, t("emailchange.failedBody")));
      body.appendChild(el("a.btn.btn--ghost", { href: "#/login", style: { marginTop: "var(--s-3)" } }, t("login.signIn")));
    }
  }

  (async () => {
    if (!token) return paint(false);
    paint(await redeem(token));
  })();

  const node = el("div.settings", {}, [
    el("h1", {}, t("emailchange.pageTitle")),
    el("section.panel", {}, [body]),
    el("a.btn.btn--ghost", { href: "#/settings" }, [icon(ICONS.back, 16), t("login.back")]),
  ]);

  return { title: t("emailchange.pageTitle"), node };
}

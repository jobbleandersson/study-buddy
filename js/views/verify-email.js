// #/verify?token=... — the link from a verification email. Reachable signed in or out: someone
// may well tap it from a different device than the one they signed up on.

import { store } from "../store.js";
import { el, clear, icon, ICONS } from "../lib/dom.js";
import { t } from "../lib/i18n.js";

// A link can only be redeemed once, but this view can render more than once for the same link -
// the app re-renders the current route on a language switch, for one. The second render would ask
// the server again, hear "already used", and turn a success into a failure. So: one request per
// token per page load, and every render after that reuses its answer.
const redeemed = new Map();   // token -> Promise<boolean>
function redeem(token) {
  if (!redeemed.has(token)) {
    redeemed.set(token, store.verifyEmail(token).then(() => true, () => false));
  }
  return redeemed.get(token);
}

export function renderVerifyEmail(qs) {
  const token = qs?.get?.("token") || "";
  const body = el("div", {}, [el("p.note", {}, t("verify.checking"))]);

  function paint(ok) {
    clear(body);
    if (ok) {
      body.appendChild(el("p", {}, [icon(ICONS.check, 18), " " + t("verify.success")]));
      body.appendChild(el("p.note", {}, t("verify.successBody")));
      body.appendChild(el("a.btn", { href: store.authed ? "#/settings" : "#/login", style: { marginTop: "var(--s-3)" } }, t("verify.continue")));
    } else {
      body.appendChild(el("p.note.note--warn", {}, t("verify.failed")));
      body.appendChild(el("p.note", {}, t("verify.failedBody")));
      body.appendChild(el("a.btn.btn--ghost", { href: "#/login", style: { marginTop: "var(--s-3)" } }, t("login.signIn")));
    }
  }

  (async () => {
    if (!token) return paint(false);
    paint(await redeem(token));
  })();

  const node = el("div.settings", {}, [
    el("h1", {}, t("verify.title")),
    el("section.panel", {}, [body]),
    el("a.btn.btn--ghost", { href: "#/settings" }, [icon(ICONS.back, 16), t("login.back")]),
  ]);

  return { title: t("verify.title"), node };
}

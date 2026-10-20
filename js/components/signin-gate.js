// The signed-out face of Klasser and Förälder / lärare: what the page is for, three things you get, and
// a way in that comes straight back. Beside it, a small made-up preview of the page itself (decorative,
// aria-hidden), so a visitor sees the feature before being asked to sign in. Each view draws its own
// preview. Styles: the "Signed-out gate" block in css/app.css.

import { el, icon, ICONS } from "../lib/dom.js";
import { t } from "../lib/i18n.js";

/** `next` is the #/ route sign-in returns to. `points` are [icon, heading, body] triples. `foot` is an
 *  optional last line (a node or text) under the buttons. */
export function signInGate({ eyebrowIcon, eyebrow, title, lead, points, preview, next, foot = null }) {
  const back = encodeURIComponent(next);
  return el("section.gate", { "aria-labelledby": "gate-title" }, [
    el("div.gate__copy", {}, [
      el("p.gate__eyebrow", {}, [icon(eyebrowIcon, 15), eyebrow]),
      el("h1.gate__title", { id: "gate-title" }, title),
      el("p.gate__lead", {}, lead),
      el("ul.gate__points", {}, points.map(([ic, head, body]) => el("li", {}, [
        el("span.gate__ptic", { "aria-hidden": "true" }, icon(ic, 18)),
        el("div", {}, [el("strong", {}, head), el("span", {}, body)]),
      ]))),
      el("div.gate__cta", {}, [
        el("a.btn.btn--lg", { href: `#/login?next=${back}&mode=signup` }, [t("login.createFree"), icon(ICONS.arrow, 18)]),
        el("a.btn.btn--ghost.btn--lg", { href: `#/login?next=${back}` }, t("login.signIn")),
      ]),
      el("p.gate__fine", {}, [icon(ICONS.check, 14), t("login.comeBack")]),
      foot ? el("p.gate__foot", {}, foot) : null,
    ].filter(Boolean)),
    el("div.gate__art", { "aria-hidden": "true" }, [preview]),
  ]);
}

/** A filled bar for the previews. `tone`: "ok" | "warn" | "" (brand). */
export function gateBar(pct, tone = "") {
  return el("span.gart__bar" + (tone ? `.is-${tone}` : ""), {}, [el("span", { style: { width: `${pct}%` } })]);
}

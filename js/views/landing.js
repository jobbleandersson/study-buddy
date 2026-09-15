// The public front page at #/welcome — what a first-time visitor sees before
// the app itself. Rendered without the app shell (no sidebar, no tab bar, see
// main.js's `chrome: false`), so it reads as a product page rather than a
// screen with marketing stuffed into it.
//
// Gating lives in main.js: returning visitors, anyone with their own sets, and
// installed-PWA launches skip straight past this.

import { el, icon, ICONS } from "../lib/dom.js";
import { store } from "../store.js";
import { t, getLang, setLang, LANGS } from "../lib/i18n.js";

/** Leaving the front page counts as having seen the intro, so the old
 *  first-run modal doesn't fire on top of the app right afterwards.
 *  Hash first, flag second: marking onboarded fires a store "change", and
 *  doing it while still on the root hash would re-render the menu behind us. */
function enter(hash) {
  location.hash = hash;
  store.markOnboarded();
}

/** Shows the language you're *in*, like the app's own topbar button does — a
 *  flag-and-code badge reads as current state, not as a destination. Clicking
 *  switches to the other one; the label spells that out. */
function langSwitch() {
  const current = getLang();
  const next = LANGS.find(([c]) => c !== current);
  if (!next) return null;
  const flag = LANGS.find(([c]) => c === current)?.[2] || "";
  const hint = `${t("common.language")} → ${next[1]}`;
  return el("button.lp-lang", {
    type: "button", "aria-label": hint, title: hint,
    onclick: () => setLang(next[0]),
  }, [el("span.lp-lang__flag", { "aria-hidden": "true", html: flag }), el("span", {}, current.toUpperCase())]);
}

function header() {
  return el("header.lp-head", {}, [
    el("div.lp-head__inner", {}, [
      el("a.lp-brand", { href: "#/welcome" }, [
        el("img", { src: "assets/favicon.svg", alt: "" }),
        el("span", {}, "Studify"),
      ]),
      el("div.lp-head__actions", {}, [
        langSwitch(),
        el("button.btn.btn--ghost.btn--sm", {
          type: "button", onclick: () => enter("#/"),
        }, t("lp.openApp")),
      ].filter(Boolean)),
    ]),
  ]);
}

/** A faux question card — the real thing, rebuilt from landing-scoped classes
 *  so app CSS changes can never quietly break the front page. */
function preview() {
  return el("div.lp-mock", { "aria-hidden": "true" }, [
    el("div.lp-mock__bar", {}, [
      el("span.lp-mock__dot"), el("span.lp-mock__dot"), el("span.lp-mock__dot"),
    ]),
    el("div.lp-mock__body", {}, [
      el("div.lp-mock__meta", {}, [
        el("span.lp-mock__tag", {}, t("lp.mockSubject")),
        el("span.lp-mock__count", {}, t("lp.mockProgress")),
      ]),
      el("div.lp-mock__track", {}, [el("i")]),
      el("p.lp-mock__q", {}, t("lp.mockQuestion")),
      el("div.lp-mock__opts", {}, [
        el("div.lp-mock__opt", {}, [el("b", {}, "A"), t("lp.mockA")]),
        el("div.lp-mock__opt.is-right", {}, [el("b", {}, "B"), t("lp.mockB"), icon(ICONS.check, 16)]),
        el("div.lp-mock__opt", {}, [el("b", {}, "C"), t("lp.mockC")]),
      ]),
      el("div.lp-mock__note", {}, [icon(ICONS.spark, 14), t("lp.mockExplain")]),
    ]),
  ]);
}

function hero() {
  return el("section.lp-hero", {}, [
    el("div.lp-hero__copy", {}, [
      el("span.lp-chip", {}, [icon(ICONS.download, 14), t("lp.chip")]),
      el("h1.lp-h1", {}, t("lp.title")),
      el("p.lp-lead", {}, t("lp.lead")),
      el("div.lp-cta", {}, [
        el("button.btn.btn--lg", { type: "button", onclick: () => enter("#/library") },
          [t("lp.ctaPrimary"), icon(ICONS.arrow, 18)]),
        el("button.btn.btn--ghost.btn--lg", { type: "button", onclick: () => enter("#/") },
          t("lp.ctaSecondary")),
      ]),
      el("p.lp-fineprint", {}, t("lp.fineprint")),
    ]),
    el("div.lp-hero__art", {}, [preview()]),
  ]);
}

function features() {
  const rows = [
    { k: "grape", i: ICONS.book, t: "lp.f1title", b: "lp.f1body" },
    { k: "sky", i: ICONS.camera, t: "lp.f2title", b: "lp.f2body" },
    { k: "leaf", i: ICONS.layers, t: "lp.f3title", b: "lp.f3body" },
    { k: "tangerine", i: ICONS.award, t: "lp.f4title", b: "lp.f4body" },
  ];
  return el("section.lp-sec", {}, [
    el("h2.lp-h2", {}, t("lp.featTitle")),
    el("p.lp-sub", {}, t("lp.featSub")),
    el("div.lp-grid", {}, rows.map((r) => el("article.lp-card", {
      style: { "--accent": `var(--c-${r.k})`, "--accent-tint": `var(--c-${r.k}-tint)`, "--accent-ink": `var(--c-${r.k}-ink)` },
    }, [
      el("span.lp-card__ic", {}, icon(r.i, 22)),
      el("h3", {}, t(r.t)),
      el("p", {}, t(r.b)),
    ]))),
  ]);
}

function steps() {
  const items = ["lp.s1", "lp.s2", "lp.s3"];
  return el("section.lp-sec.lp-sec--steps", {}, [
    el("h2.lp-h2", {}, t("lp.stepsTitle")),
    el("ol.lp-steps", {}, items.map((k, i) => el("li.lp-step", {}, [
      el("span.lp-step__n", {}, String(i + 1)),
      el("div", {}, [
        el("h3", {}, t(`${k}title`)),
        el("p", {}, t(`${k}body`)),
      ]),
    ]))),
  ]);
}

function trust() {
  const items = [
    { i: ICONS.download, k: "lp.t1" },
    { i: ICONS.shield, k: "lp.t2" },
    { i: ICONS.check, k: "lp.t3" },
    { i: ICONS.check, k: "lp.t4" },
  ];
  return el("section.lp-trust", {}, items.map((x) => el("div.lp-trust__item", {}, [
    icon(x.i, 16), el("span", {}, t(x.k)),
  ])));
}

function closer() {
  return el("section.lp-closer", {}, [
    el("h2.lp-h2", {}, t("lp.closeTitle")),
    el("p.lp-sub", {}, t("lp.closeBody")),
    el("button.btn.btn--lg", { type: "button", onclick: () => enter("#/library") },
      [t("lp.ctaPrimary"), icon(ICONS.arrow, 18)]),
  ]);
}

function footer() {
  return el("footer.lp-foot", {}, [
    el("div.lp-foot__inner", {}, [
      el("span.lp-foot__brand", {}, [
        el("img", { src: "assets/favicon.svg", alt: "" }), "Studify",
      ]),
      el("nav.lp-foot__links", { "aria-label": t("footer.nav") }, [
        el("a", { href: "#/about" }, t("footer.about")),
        el("a", { href: "#/terms" }, t("footer.terms")),
        el("a", { href: "#/privacy" }, t("footer.privacy")),
        el("a", { href: "mailto:liamohrn0911@gmail.com" }, t("footer.contact")),
      ]),
      el("span.lp-foot__copy", {}, t("footer.copy")),
    ]),
  ]);
}

export function renderLanding() {
  return {
    title: t("lp.pageTitle"),
    chrome: false,
    node: el("div.lp", {}, [
      el("div.lp-glow", { "aria-hidden": "true" }),
      header(),
      el("main.lp-main", { id: "main" }, [
        hero(),
        features(),
        steps(),
        trust(),
        closer(),
      ]),
      footer(),
    ]),
  };
}

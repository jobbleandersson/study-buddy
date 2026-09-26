// The public front page at #/welcome — what a first-time visitor sees before
// the app itself. Rendered without the app shell (no sidebar, no tab bar, see
// main.js's `chrome: false`), so it reads as a product page rather than a
// screen with marketing stuffed into it.
//
// Gating lives in main.js: returning visitors, anyone with their own sets, and
// installed-PWA launches skip straight past this.

import { el, icon, ICONS, TIKTOK_SVG } from "../lib/dom.js";
import { store } from "../store.js";
import { CONTACT_EMAIL, TIKTOK_URL, REVIEWS_URL } from "../config.js";
import { t, getLang, setLang, LANGS } from "../lib/i18n.js";
import { openWelcomeQuiz } from "../components/onboarding.js";
import { REVIEWS, publishableReviews } from "../data/reviews.js";
import { STUDY_MODES } from "../lib/study-modes.js";

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

/** Smooth-scrolls to a section of the front page. The app routes on the hash, so these can't be
 *  plain #anchor links — that would navigate away to an unknown route. */
function scrollToId(id) {
  const target = document.getElementById(id);
  if (!target) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

const NAV = [["lp-features", "lp.navFeatures"], ["lp-ai", "lp.navAi"], ["lp-hp", "lp.navHp"], ["lp-subjects", "lp.navSubjects"], ["lp-faq", "lp.navFaq"]];

/** The front pages' top bar. On the student front page (`sections: true`) it carries links to
 *  that page's own sections; the teacher page links back here instead. Sticky, and it gains a
 *  hairline once the page scrolls. */
export function header({ sections = false } = {}) {
  const links = sections
    ? NAV.map(([id, key]) => el("a.lp-nav__link", {
      href: "#/welcome", onclick: (e) => { e.preventDefault(); scrollToId(id); },
    }, t(key)))
    : [el("a.lp-nav__link", { href: "#/welcome" }, t("lp.forStudentT"))];
  links.push(el("a.lp-nav__link", { href: "#/teachers" }, t("lp.navTeachers")));

  const bar = el("header.lp-head", {}, [
    el("div.lp-head__inner", {}, [
      el("a.lp-brand", { href: "#/welcome" }, [
        el("img", { src: "assets/favicon.svg", alt: "", width: 28, height: 28 }),
        el("span", {}, "Studify"),
      ]),
      el("nav.lp-nav", { "aria-label": t("lp.navAria") }, links),
      el("div.lp-head__actions", {}, [
        langSwitch(),
        store.authed ? null : el("a.lp-head__login", { href: "#/login" }, t("lp.navLogin")),
        el("button.btn.btn--sm.lp-head__cta", { type: "button", onclick: () => openWelcomeQuiz() }, t("lp.navStart")),
      ].filter(Boolean)),
    ]),
  ]);
  const onScroll = () => {
    if (!bar.isConnected) { window.removeEventListener("scroll", onScroll); return; }
    bar.classList.toggle("is-scrolled", window.scrollY > 8);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  return bar;
}

/** The hero: a question you can actually answer, built from landing-scoped
 *  classes so app CSS changes can never quietly break the front page. Wrong
 *  answers stay open to another try (as in the app); the right one locks the
 *  card and shows the explanation. */
const RIGHT = 1;

function questionCard() {
  const segs = [0, 1, 2, 3, 4].map((i) => el(i < 2 ? "i.is-done" : i === 2 ? "i.is-now" : "i"));
  const fb = el("p.lp-q__fb", { "aria-live": "polite" }, t("lp.mockPrompt"));
  let solved = false;

  const opts = ["lp.mockA", "lp.mockB", "lp.mockC"].map((key, idx) => el("button.lp-q__opt", {
    type: "button",
    onclick: (e) => {
      const btn = e.currentTarget;
      // aria-disabled, not disabled: a truly disabled button drops keyboard focus.
      if (solved || btn.getAttribute("aria-disabled") === "true") return;
      if (idx === RIGHT) {
        solved = true;
        btn.classList.add("is-right");
        btn.appendChild(icon(ICONS.check, 16));
        opts.forEach((o) => { if (o !== btn) o.setAttribute("aria-disabled", "true"); });
        segs[2].className = "is-done";
        fb.className = "lp-q__fb is-right";
        fb.replaceChildren(icon(ICONS.spark, 14), t("lp.mockExplain"));
      } else {
        btn.classList.add("is-wrong");
        btn.setAttribute("aria-disabled", "true");
        fb.className = "lp-q__fb is-wrong";
        fb.textContent = t("lp.mockWrong");
      }
    },
  }, [el("b", {}, "ABC"[idx]), el("span", {}, t(key))]));

  return el("div.lp-q", {}, [
    el("div.lp-q__meta", {}, [
      el("b", {}, t("lp.mockSubject")),
      el("span.lp-q__count", {}, t("lp.mockProgress")),
    ]),
    el("div.lp-q__track", { "aria-hidden": "true" }, segs),
    el("p.lp-q__prompt", { id: "lp-q-prompt" }, t("lp.mockQuestion")),
    el("div.lp-q__opts", { role: "group", "aria-labelledby": "lp-q-prompt" }, opts),
    fb,
  ]);
}

/** A small ✓ list under the hero's buttons — four plain facts, each one true today. */
function heroChecks() {
  return el("ul.lp-checks", {}, ["lp.check1", "lp.check2", "lp.check3", "lp.check4"].map((k) =>
    el("li", {}, [icon(ICONS.check, 15), t(k)])));
}

/** The hero: headline, two actions, and below them the real app — a screenshot of the home page
 *  (made by tools/landing-shots.mjs) with the playable question card over its corner. On a phone
 *  the screenshot would be unreadable, so the question card stands alone there. */
function hero() {
  const lang = getLang() === "en" ? "en" : "sv";
  return el("section.lp-hero", {}, [
    el("div.lp-hero__copy", {}, [
      el("a.lp-eyebrow", { href: "#/solve", onclick: (e) => { e.preventDefault(); enter("#/solve"); } }, [
        el("span.lp-eyebrow__dot", { "aria-hidden": "true" }),
        el("span", {}, t("lp.eyebrow")),
        icon(ICONS.arrow, 14),
      ]),
      el("h1.lp-h1", {}, [t("lp.heroA"), " ", el("span.lp-h1__accent", {}, t("lp.heroB"))]),
      el("p.lp-lead", {}, t("lp.lead")),
      el("div.lp-cta", {}, [
        el("button.btn.btn--lg", { type: "button", onclick: () => openWelcomeQuiz() }, [t("lp.ctaStart"), icon(ICONS.arrow, 18)]),
        el("button.btn.btn--ghost.btn--lg", { type: "button", onclick: () => scrollToId("lp-features") }, t("lp.ctaTour")),
      ]),
      heroChecks(),
    ]),
    el("div.lp-stage", {}, [
      el("figure.lp-stage__shot", {}, [
        el("div.lp-frame__bar", { "aria-hidden": "true" }, [el("i"), el("i"), el("i"), el("span", {}, "studify")]),
        el("img", {
          src: `assets/shots/home-${lang}.jpg`, alt: t("lp.heroAlt"),
          width: 2160, height: 1350, decoding: "async", fetchpriority: "high",
        }),
      ]),
      el("div.lp-stage__card", {}, [questionCard()]),
      el("div.lp-badge.lp-badge--hint", { "aria-hidden": "true" }, [
        el("span.lp-badge__icon", {}, [icon(ICONS.spark, 14)]),
        el("span", {}, [el("b", {}, t("lp.badgeHintLabel")), t("lp.badgeHint")]),
      ]),
      el("div.lp-badge.lp-badge--repeat", { "aria-hidden": "true" }, [
        el("span.lp-badge__icon", {}, [icon(ICONS.calendar, 14)]),
        el("span", {}, t("lp.badgeRepeat")),
      ]),
    ]),
  ]);
}

/** Four numbers, all read off the real library (tools/validate-library.mjs counts them). */
function stats() {
  return el("section.lp-stats", {}, [
    el("dl.lp-stats__inner", {}, [1, 2, 3, 4].map((n) => el("div.lp-stat", {}, [
      el("dt", {}, t(`lp.stat${n}L`)),
      el("dd", {}, t(`lp.stat${n}N`)),
    ]))),
  ]);
}

/* Each feature gets a picture only it could have: the real subjects, the real
   eight delprov as an answer sheet, the forgetting curve, the three inputs. */

const HUES = ["grape", "ocean", "leaf", "tangerine", "berry", "sky"];

function libraryArt() {
  return el("div", {}, [
    el("ul.lp-subjects", {}, t("lp.subjectList").split("|").map((name, i) => {
      const hue = HUES[i % HUES.length];
      // Named --subj-*, not --tint/--ink: those would shadow the app's own
      // global --ink token for anything nested inside this <li>, which reads
      // fine here but silently breaks the moment something else needs the
      // real text color inside one of these pills.
      return el("li", { style: { "--subj-tint": `var(--c-${hue}-tint)`, "--subj-ink": `var(--c-${hue}-ink)` } }, name);
    })),
    el("ul.lp-levels", {}, t("lp.levels").split("|").map((l) => el("li", {}, l))),
  ]);
}

function sourcesArt() {
  const rows = [[ICONS.pencil, "lp.srcNotes"], [ICONS.fileText, "lp.srcPdf"], [ICONS.camera, "lp.srcPhoto"]];
  return el("div.lp-src", {}, [
    el("ul", {}, rows.map(([ic, key]) => el("li", {}, [icon(ic, 20), el("span", {}, t(key))]))),
    el("div.lp-src__out", {}, [icon(ICONS.spark, 18), t("lp.srcResult")]),
  ]);
}

const CURVE_SVG = `<svg viewBox="0 0 480 210" role="img" aria-hidden="true" focusable="false">
  <line class="grid" x1="24" y1="30" x2="456" y2="30"/><line class="grid" x1="24" y1="110" x2="456" y2="110"/>
  <line class="grid" x1="24" y1="190" x2="456" y2="190"/>
  <path class="without" d="M24 34 C70 112 140 158 456 176"/>
  <path class="with" d="M24 34 C60 66 110 88 150 98 L150 46 C185 68 235 82 270 88 L270 44 C300 62 350 74 390 76 L390 46 C415 58 440 64 456 66"/>
  <circle class="dot" cx="150" cy="46" r="5"/><circle class="dot" cx="270" cy="44" r="5"/><circle class="dot" cx="390" cy="46" r="5"/>
</svg>`;

function curveArt() {
  return el("div.lp-curve", {}, [
    el("div.lp-curve__legend", {}, [
      el("span", {}, [el("i"), t("lp.curveWith")]),
      el("span", {}, [el("i.is-dashed"), t("lp.curveWithout")]),
    ]),
    el("div", { html: CURVE_SVG }),
    el("div.lp-curve__axis", {}, [el("span", {}, t("lp.curveNow")), el("span", {}, t("lp.curveLater"))]),
    el("p.lp-curve__note", {}, t("lp.curveNote")),
  ]);
}

// Real delprov, with the real number of answer options each one uses.
const SHEET = [
  ["hp.verbal", [["ORD", 5], ["LÄS", 4], ["MEK", 4], ["ELF", 4]]],
  ["hp.kvant", [["XYZ", 5], ["KVA", 4], ["NOG", 5], ["DTK", 5]]],
];

function sheetArt() {
  return el("div.lp-sheet", {}, SHEET.map(([label, cells]) => el("div", {}, [
    el("h4", {}, t(label)),
    el("div.lp-sheet__cells", {}, cells.map(([code, n], ci) => el("div.lp-sheet__cell", {}, [
      el("b", {}, code),
      el("div.lp-sheet__bubbles", { "aria-hidden": "true" },
        Array.from({ length: n }, (_, k) => el(k === (ci * 2 + 1) % n ? "span.is-on" : "span", {}, "ABCDE"[k]))),
    ]))),
  ])));
}

/** A "<title> / <sub> / N illustrated rows" section — the same shape on the
 *  consumer and teacher front pages, each with its own string prefix and art.
 *  Exported so #/teachers builds its three rows from this instead of
 *  re-describing the same markup. */
export function featureSection(prefix, rows) {
  return el("section.lp-sec", {}, [
    el("h2.lp-h2", {}, t(`${prefix}.featTitle`)),
    el("p.lp-sub", {}, t(`${prefix}.featSub`)),
    el("div.lp-rows", {}, rows.map(([k, art]) => el("article.lp-row", {}, [
      el("div.lp-row__text", {}, [el("h3", {}, t(`${prefix}.${k}title`)), el("p", {}, t(`${prefix}.${k}body`))]),
      el("div.lp-row__art", {}, [art()]),
    ]))),
  ]);
}

function eyebrow(key) { return el("p.lp-eyebrow-text", {}, t(key)); }

/** A short, static tutor exchange — what the AI tutor's answers look like. Illustrative, so it's
 *  hidden from screen readers; the section's own text says the same in words. */
function chatArt({ modes = false } = {}) {
  return el("div.lp-chat", { "aria-hidden": "true" }, [
    modes ? el("div.lp-chat__modes", {}, STUDY_MODES.map((m) => el("span", {}, [icon(ICONS[m.icon] || ICONS.spark, 13), t(`chat.mode.${m.id}`)]))) : null,
    el("div.lp-chat__msgs", {}, [
      el("p.lp-chat__me", {}, t("lp.aiChatUser")),
      el("div.lp-chat__bot", {}, [
        el("span.lp-chat__avatar", {}, [icon(ICONS.spark, 14)]),
        el("div", {}, [el("p", {}, t("lp.aiChatBot")), el("span.lp-chat__chip", {}, t("lp.aiChatFollow"))]),
      ]),
    ]),
    modes ? el("div.lp-chat__input", {}, [icon(ICONS.camera, 16), el("span", {}, t("lp.aiChatInput")), el("b", {}, [icon(ICONS.arrow, 14)])]) : null,
  ].filter(Boolean));
}

function progressArt() {
  const rows = [["lp.progT1", 92, "ok"], ["lp.progT2", 68, "mid"], ["lp.progT3", 41, "low"]];
  return el("div.lp-prog", { "aria-hidden": "true" }, [
    el("p.lp-prog__cap", {}, t("lp.progEx")),
    ...rows.map(([k, pct, tone]) => el("div.lp-prog__row", {}, [
      el("span", {}, t(k)),
      el("i", {}, [el(`b.is-${tone}`, { style: { width: `${pct}%` } })]),
      el("span.lp-prog__pct", {}, `${pct} %`),
    ])),
  ]);
}

/** "Everything you need": a bento grid — each tile one feature with a picture only it could have. */
function features() {
  const tile = (cls, title, body, art) => el(`article.lp-tile${cls}`, {}, [
    el("div.lp-tile__text", {}, [el("h3", {}, t(title)), el("p", {}, t(body))]),
    el("div.lp-tile__art", {}, [art()]),
  ]);
  return el("section.lp-sec", { id: "lp-features" }, [
    el("div.lp-sechead", {}, [
      eyebrow("lp.bentoEyebrow"),
      el("h2.lp-h2", {}, t("lp.bentoTitle")),
      el("p.lp-sub", {}, t("lp.bentoSub")),
    ]),
    el("div.lp-bento", {}, [
      tile(".lp-tile--wide", "lp.f1title", "lp.f1body", libraryArt),
      tile("", "lp.bAiTitle", "lp.bAiBody", () => chatArt()),
      tile("", "lp.f3title", "lp.f3body", curveArt),
      tile("", "lp.f2title", "lp.f2body", sourcesArt),
      tile("", "lp.bProgTitle", "lp.bProgBody", progressArt),
    ]),
  ]);
}

/** A dark band for the AI tutor — the one feature a visitor most wants to see in action. */
function aiSection() {
  return el("section.lp-band.theme-night", { id: "lp-ai" }, [
    el("div.lp-band__inner", {}, [
      el("div.lp-band__copy", {}, [
        eyebrow("lp.aiEyebrow"),
        el("h2.lp-h2", {}, t("lp.aiTitle")),
        el("p.lp-sub", {}, t("lp.aiBody")),
        el("ul.lp-points", {}, ["lp.aiP1", "lp.aiP5", "lp.aiP2", "lp.aiP3", "lp.aiP4"].map((k) => el("li", {}, [icon(ICONS.check, 16), t(k)]))),
        el("button.btn.btn--lg", { type: "button", onclick: () => enter("#/solve") }, [t("lp.aiCta"), icon(ICONS.arrow, 18)]),
      ]),
      el("div.lp-band__art", {}, [chatArt({ modes: true })]),
    ]),
  ]);
}

function hpSection() {
  return el("section.lp-sec.lp-split", { id: "lp-hp" }, [
    el("div.lp-split__art", {}, [sheetArt()]),
    el("div.lp-split__copy", {}, [
      eyebrow("lp.hpEyebrow"),
      el("h2.lp-h2", {}, t("lp.hpTitle")),
      el("p.lp-sub", {}, t("lp.hpBody")),
      el("ul.lp-points", {}, ["lp.hpP1", "lp.hpP2", "lp.hpP3"].map((k) => el("li", {}, [icon(ICONS.check, 16), t(k)]))),
      el("button.btn.btn--ghost.btn--lg", { type: "button", onclick: () => enter("#/hp") }, [t("lp.hpCta"), icon(ICONS.arrow, 18)]),
    ]),
  ]);
}

const SUBJECT_ICONS = [ICONS.sigma, ICONS.pencil, ICONS.message, ICONS.spark, ICONS.target, ICONS.layers, ICONS.book, ICONS.compass, ICONS.users, ICONS.medal, ICONS.flag, ICONS.flag, ICONS.flag];

/** Every subject in the library, each a door into the public practice pages at /ova. */
function subjects() {
  const names = t("lp.subjectList").split("|");
  return el("section.lp-sec", { id: "lp-subjects" }, [
    el("div.lp-sechead", {}, [
      el("h2.lp-h2", {}, t("lp.subjTitle")),
      el("p.lp-sub", {}, t("lp.subjSub")),
    ]),
    el("ul.lp-subjgrid", {}, names.map((name, i) => {
      const hue = HUES[i % HUES.length];
      return el("li", { style: { "--subj-tint": `var(--c-${hue}-tint)`, "--subj-ink": `var(--c-${hue}-ink)` } }, [
        el("span.lp-subjgrid__ic", { "aria-hidden": "true" }, [icon(SUBJECT_ICONS[i] || ICONS.book, 18)]),
        el("span", {}, name),
      ]);
    })),
    el("div.lp-levelrow", {}, [
      el("ul.lp-levels", {}, t("lp.levels").split("|").map((l) => el("li", {}, l))),
      el("a.lp-more", { href: "/ova" }, [t("lp.subjAll"), icon(ICONS.arrow, 15)]),
    ]),
  ]);
}

function audiences() {
  const card = (ic, title, body, link, onclick) => el("article.lp-aud", {}, [
    el("span.lp-aud__ic", { "aria-hidden": "true" }, [icon(ic, 20)]),
    el("h3", {}, t(title)),
    el("p", {}, t(body)),
    el("a.lp-more", { href: "#/welcome", onclick: (e) => { e.preventDefault(); onclick(); } }, [t(link), icon(ICONS.arrow, 15)]),
  ]);
  return el("section.lp-sec", {}, [
    el("div.lp-sechead", {}, [el("h2.lp-h2", {}, t("lp.forTitle"))]),
    el("div.lp-auds", {}, [
      card(ICONS.graduation, "lp.forStudentT", "lp.forStudentB", "lp.forStudentL", () => openWelcomeQuiz()),
      card(ICONS.users, "lp.forParentT", "lp.forParentB", "lp.forParentL", () => enter("#/faq")),
      card(ICONS.presentation, "lp.forTeacherT", "lp.forTeacherB", "lp.forTeacherL", () => { location.hash = "#/teachers"; }),
    ]),
  ]);
}

/** Why Studify is safe to use. Every line is a fact about how the app works today. */
function trust() {
  const items = [[ICONS.book, 1], [ICONS.target, 2], [ICONS.shield, 3], [ICONS.lock, 4], [ICONS.flag, 5], [ICONS.users, 6]];
  return el("section.lp-sec", { id: "lp-trust" }, [
    el("div.lp-sechead", {}, [
      eyebrow("lp.trustEyebrow"),
      el("h2.lp-h2", {}, t("lp.trustTitle")),
      el("p.lp-sub", {}, t("lp.trustSub")),
    ]),
    el("ul.lp-trustgrid", {}, items.map(([ic, n]) => el("li", {}, [
      el("span.lp-trustgrid__ic", { "aria-hidden": "true" }, [icon(ic, 18)]),
      el("div", {}, [el("h3", {}, t(`lp.tr${n}T`)), el("p", {}, t(`lp.tr${n}B`))]),
    ]))),
  ]);
}

function pricing() {
  const feat = (k) => el("li", {}, [icon(ICONS.check, 16), t(k)]);
  return el("section.lp-sec", { id: "lp-price" }, [
    el("div.lp-sechead.lp-sechead--center", {}, [
      eyebrow("lp.priceEyebrow"),
      el("h2.lp-h2", {}, t("lp.priceTitle")),
      el("p.lp-sub", {}, t("lp.priceSub")),
    ]),
    el("div.lp-plans", {}, [
      el("article.lp-plan.lp-plan--main", {}, [
        el("div.lp-plan__top", {}, [el("h3", {}, t("lp.freeName")), el("span.lp-plan__badge", {}, t("lp.freeBadge"))]),
        el("p.lp-plan__price", {}, [el("b", {}, t("lp.freePrice")), el("span", {}, t("lp.freePer"))]),
        el("ul.lp-plan__list", {}, ["lp.freeF1", "lp.freeF2", "lp.freeF3", "lp.freeF4", "lp.freeF5"].map(feat)),
        el("button.btn.btn--lg", { type: "button", onclick: () => openWelcomeQuiz() }, t("lp.ctaStart")),
      ]),
      el("article.lp-plan", {}, [
        el("div.lp-plan__top", {}, [el("h3", {}, t("lp.premName")), el("span.lp-plan__badge.is-muted", {}, t("lp.premBadge"))]),
        el("p.lp-plan__price", {}, [el("b", {}, t("lp.premPrice"))]),
        el("p.lp-plan__body", {}, t("lp.premBody")),
        el("button.btn.btn--ghost.btn--lg", { type: "button", onclick: () => enter("#/premium") }, t("lp.premCta")),
      ]),
    ]),
  ]);
}

function faq() {
  return el("section.lp-sec.lp-faqsec", { id: "lp-faq" }, [
    el("div.lp-sechead", {}, [el("h2.lp-h2", {}, t("lp.faqTitle"))]),
    el("div.lp-faq", {}, [1, 2, 3, 4, 5, 6].map((n) => el("details.lp-faq__item", {}, [
      el("summary", {}, [el("span", {}, t(`faq.q${n}Title`)), icon(ICONS.plus, 18)]),
      el("p", {}, t(`faq.q${n}Body`)),
    ]))),
    el("a.lp-more", { href: "#/faq" }, [t("lp.faqMore"), icon(ICONS.arrow, 15)]),
  ]);
}

/** A numbered "how it works" strip — see featureSection() above for the same
 *  reasoning; also exported for #/teachers. */
export function stepsSection(titleKey, items) {
  return el("section.lp-sec.lp-sec--steps", {}, [
    el("h2.lp-h2", {}, t(titleKey)),
    el("ol.lp-steps", {}, items.map((k, i) => el("li.lp-step", {}, [
      el("span.lp-step__n", { "aria-hidden": "true" }, String(i + 1)),
      el("h3", {}, t(`${k}title`)),
      el("p", {}, t(`${k}body`)),
    ]))),
  ]);
}

function steps() {
  return stepsSection("lp.stepsTitle", ["lp.s1", "lp.s2", "lp.s3"]);
}

/** Real reviews, newest first: approved ones from the server (written in #/rate) plus any added by
 *  hand in js/data/reviews.js. The section stays hidden until there is at least one — the server
 *  list arrives after first paint, so it fills in then. Each quote keeps the language it was
 *  written in, marked with lang= for screen readers. */
function reviewCard(r) {
  return el("li", {}, [
    el("figure.lp-review", {}, [
      r.rating ? el("p.lp-review__stars", {
        role: "img", "aria-label": t("lp.reviewStars", { n: r.rating }),
      }, "★".repeat(r.rating) + "☆".repeat(5 - r.rating)) : null,
      el("blockquote", { lang: r.lang }, [el("p", {}, r.text)]),
      el("figcaption", {}, [
        el("b", {}, r.name),
        r.context ? el("span", { lang: r.lang }, r.context) : null,
      ].filter(Boolean)),
    ].filter(Boolean)),
  ]);
}

function reviews() {
  const list = el("ul.lp-reviews");
  const section = el("section.lp-sec", { "aria-labelledby": "lp-reviews-title", hidden: true }, [
    el("h2.lp-h2", { id: "lp-reviews-title" }, t("lp.reviewsTitle")),
    list,
    el("p.lp-sub.lp-reviews__cta", {}, [t("lp.reviewsCta") + " ", el("a", { href: "#/rate" }, t("lp.reviewsCtaLink"))]),
  ]);
  const paint = (items) => {
    const shown = publishableReviews(items);
    list.replaceChildren(...shown.map(reviewCard));
    section.hidden = !shown.length;
  };
  paint(REVIEWS);
  fetch(REVIEWS_URL)
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      const fromServer = Array.isArray(data?.reviews) ? data.reviews.map((r) => ({ ...r, consent: true })) : [];
      if (fromServer.length) paint([...fromServer, ...REVIEWS]);
    })
    .catch(() => { /* no server (static hosting, offline): the hand-added list is all there is */ });
  return section;
}

function closer() {
  return el("section.lp-closer", {}, [
    el("div", {}, [
      el("h2.lp-h2", {}, t("lp.closeTitle")),
      el("p.lp-sub", {}, t("lp.closeBody")),
    ]),
    el("div.lp-closer__cta", {}, [
      el("button.btn.btn--lg.lp-closer__btn", { type: "button", onclick: () => openWelcomeQuiz() }, [t("lp.ctaStart"), icon(ICONS.arrow, 18)]),
      el("p.lp-teachnote", {}, [t("lp.teacherNote"), " ", el("a", { href: "#/teachers" }, t("lp.teacherLink"))]),
    ]),
  ]);
}

export function footer() {
  const col = (title, links) => el("div.lp-foot__col", {}, [
    el("h4", {}, t(title)),
    el("ul", {}, links.map(([href, key]) => el("li", {}, [el("a", { href }, t(key))]))),
  ]);
  return el("footer.lp-foot", {}, [
    el("div.lp-foot__inner", {}, [
      el("div.lp-foot__about", {}, [
        el("span.lp-foot__brand", {}, [el("img", { src: "assets/favicon.svg", alt: "", width: 24, height: 24 }), "Studify"]),
        el("p", {}, t("lp.footBlurb")),
        el("div.lp-foot__social", {}, [
          el("a.lp-foot__social-link", {
            href: TIKTOK_URL, target: "_blank", rel: "noopener noreferrer", "aria-label": "TikTok", html: TIKTOK_SVG,
          }),
        ]),
      ]),
      el("nav.lp-foot__cols", { "aria-label": t("footer.nav") }, [
        col("lp.footProduct", [["/ova", "footer.practice"], ["#/solve", "nav.solve"], ["#/hp", "nav.hp"], ["#/exam-prep", "nav.examPrep"]]),
        col("lp.footFor", [["#/welcome", "lp.forStudentT"], ["#/faq", "lp.forParentT"], ["#/teachers", "lp.forTeacherT"]]),
        col("lp.footCompany", [["#/about", "footer.about"], ["#/faq", "footer.faq"], [`mailto:${CONTACT_EMAIL}`, "footer.contact"]]),
        col("lp.footLegal", [["#/terms", "footer.terms"], ["#/privacy", "footer.privacy"]]),
      ]),
    ]),
    el("div.lp-foot__base", {}, [
      el("span", {}, `© ${new Date().getFullYear()} Studify`),
      el("span", {}, t("footer.copy")),
    ]),
  ]);
}

export function renderLanding() {
  return {
    title: t("lp.pageTitle"),
    chrome: false,
    node: el("div.lp.lp--home", {}, [
      header({ sections: true }),
      // One <main>; the dark AI band inside it runs edge to edge, so the sections around it
      // sit in their own width-capped wrappers.
      el("main.lp-body", { id: "main" }, [
        el("div.lp-main", {}, [hero(), stats(), features()]),
        aiSection(),
        el("div.lp-main", {}, [hpSection(), subjects(), audiences(), trust(), reviews(), pricing(), faq(), closer()]),
      ]),
      footer(),
    ]),
  };
}

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

export function header() {
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

/** A full-bleed strip of four short, concrete claims right under the hero —
 *  the numbers have to stay true, not just persuasive: the exercise count
 *  below is read straight from the library data, and there's no "results
 *  guarantee" item here because there's no payment system yet to refund. */
function trustBar() {
  const items = [
    [ICONS.layers, "lp.trust1Title", "lp.trust1Sub"],
    [ICONS.book, "lp.trust2Title", "lp.trust2Sub"],
    [ICONS.message, "lp.trust3Title", "lp.trust3Sub"],
    [ICONS.check, "lp.trust4Title", "lp.trust4Sub"],
  ];
  return el("section.lp-trust", {}, [
    el("div.lp-trust__inner", {}, items.map(([ic, titleKey, subKey]) => el("div.lp-trust__item", {}, [
      el("div.lp-trust__icon", { "aria-hidden": "true" }, [icon(ic, 20)]),
      el("div", {}, [el("b", {}, t(titleKey)), el("span", {}, t(subKey))]),
    ]))),
  ]);
}

function hero() {
  return el("section.lp-hero", {}, [
    el("div.lp-hero__copy", {}, [
      el("h1.lp-h1", {}, t("lp.title")),
      el("p.lp-lead", {}, t("lp.lead")),
      el("div.lp-cta", {}, [
        el("button.btn.btn--lg", { type: "button", onclick: () => openWelcomeQuiz() }, t("lp.ctaPrimary")),
        el("button.btn.btn--ghost.btn--lg", { type: "button", onclick: () => enter("#/") },
          t("lp.ctaSecondary")),
      ]),
      el("p.lp-fineprint", {}, t("lp.fineprint")),
    ]),
    el("div.lp-hero__art", {}, [questionCard()]),
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

function features() {
  return featureSection("lp", [["f1", libraryArt], ["f2", sourcesArt], ["f3", curveArt], ["f4", sheetArt]]);
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
      el("p.lp-teachnote", {}, [
        t("lp.teacherNote"), " ",
        el("a", { href: "#/teachers" }, t("lp.teacherLink")),
      ]),
    ]),
    el("button.btn.btn--lg", { type: "button", onclick: () => openWelcomeQuiz() }, t("lp.ctaPrimary")),
  ]);
}

export function footer() {
  return el("footer.lp-foot", {}, [
    el("div.lp-foot__inner", {}, [
      el("span.lp-foot__brand", {}, [
        el("img", { src: "assets/favicon.svg", alt: "" }), "Studify",
      ]),
      el("nav.lp-foot__links", { "aria-label": t("footer.nav") }, [
        el("a", { href: "#/teachers" }, t("footer.teachers")),
        el("a", { href: "#/about" }, t("footer.about")),
        el("a", { href: "#/faq" }, t("footer.faq")),
        el("a", { href: "#/terms" }, t("footer.terms")),
        el("a", { href: "#/privacy" }, t("footer.privacy")),
        el("a", { href: `mailto:${CONTACT_EMAIL}` }, t("footer.contact")),
      ]),
      el("span.lp-foot__copy", {}, t("footer.copy")),
      el("div.lp-foot__social", {}, [
        el("a.lp-foot__social-link", {
          href: TIKTOK_URL, target: "_blank", rel: "noopener noreferrer", "aria-label": "TikTok", html: TIKTOK_SVG,
        }),
      ]),
    ]),
  ]);
}

export function renderLanding() {
  return {
    title: t("lp.pageTitle"),
    chrome: false,
    node: el("div.lp", {}, [
      header(),
      el("main.lp-main", { id: "main" }, [
        hero(),
        trustBar(),
        features(),
        steps(),
        reviews(),
        closer(),
      ]),
      footer(),
    ]),
  };
}

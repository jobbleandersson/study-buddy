// The public "for teachers" page at #/teachers — reachable from the main
// front page's footer and closer, and from Studify's own site footer, so a
// teacher who's heard about the app (or a student pointing their teacher at
// it) lands somewhere written for them specifically, not a repurposed
// student pitch.
//
// Rendered without the app shell (chrome: false), reusing the front page's
// own header and footer so the two pages read as one site. Everything below
// is static content — no fetches, works signed out.

import { el, icon, ICONS } from "../lib/dom.js";
import { store } from "../store.js";
import { t } from "../lib/i18n.js";
import { header, footer, featureSection, stepsSection } from "./landing.js";

/** Straight to the class hub if already signed in; otherwise via sign-in,
 *  carrying `?next=` so login.js sends them on to Klasser afterwards. */
function ctaHref() {
  return store.authed ? "#/classes" : `#/login?next=${encodeURIComponent("#/classes")}`;
}
function ctaLabel() {
  return store.authed ? t("teachers.ctaGo") : t("teachers.ctaCreate");
}

/** The hero art: a teacher's-eye view of one day's question, already
 *  answered — the single most distinctive thing this page is selling. */
function dailyPreview() {
  const opt = (letter, text, right) => el("div.teach-daily__opt" + (right ? ".is-right" : ""), {}, [
    el("span.teach-daily__key", {}, letter),
    el("span", {}, text),
    right ? icon(ICONS.check, 14) : null,
  ].filter(Boolean));

  return el("div.teach-daily", {}, [
    el("div.teach-daily__head", {}, [
      el("span.teach-daily__chip", {}, [icon(ICONS.calendarCheck, 14), t("teachers.heroLabel")]),
      el("span.teach-daily__class", {}, t("teachers.heroClass")),
    ]),
    el("p.teach-daily__q", {}, t("teachers.heroQuestion")),
    el("div.teach-daily__opts", {}, [
      opt("A", t("teachers.heroA"), false),
      opt("B", t("teachers.heroB"), true),
      opt("C", t("teachers.heroC"), false),
    ]),
    el("div.teach-daily__result", {}, [
      icon(ICONS.check, 18),
      el("div", {}, [
        el("strong", {}, t("teachers.heroRight")),
        el("p", {}, t("teachers.heroSpread")),
      ]),
    ]),
    el("p.teach-daily__privacy", {}, [icon(ICONS.users, 13), t("teachers.heroPrivacy")]),
  ]);
}

function hero() {
  return el("section.lp-hero", {}, [
    el("div.lp-hero__copy", {}, [
      el("p.teach-eyebrow", {}, t("teachers.eyebrow")),
      el("h1.lp-h1", {}, t("teachers.title")),
      el("p.lp-lead", {}, t("teachers.lead")),
      el("div.lp-cta", {}, [
        el("a.btn.btn--lg", { href: ctaHref() }, ctaLabel()),
      ]),
      el("p.lp-fineprint", {}, t("teachers.fineprint")),
    ]),
    el("div.lp-hero__art", {}, [dailyPreview()]),
  ]);
}

/* Each feature row gets a small illustration of that one thing — assigning,
   writing a question, and the private results view — rather than one image
   doing all three jobs. */

function assignArt() {
  const steps = ["teachers.f1step1", "teachers.f1step2", "teachers.f1step3"];
  return el("ol.teach-assign", {}, steps.map((k, i) => el("li", {}, [
    el("span.teach-assign__n", { "aria-hidden": "true" }, String(i + 1)),
    el("span", {}, t(k)),
  ])));
}

function composeArt() {
  const row = (text, right) => el("div.teach-compose__row" + (right ? ".is-marked" : ""), {}, [
    el("span.teach-compose__radio", { "aria-hidden": "true" }),
    el("span", {}, text),
    right ? el("span.teach-compose__tag", {}, t("teachers.f2mark")) : null,
  ].filter(Boolean));
  return el("div.teach-compose", {}, [
    el("p.teach-compose__q", {}, t("teachers.heroQuestion")),
    el("div.teach-compose__opts", {}, [
      row(t("teachers.heroA"), false),
      row(t("teachers.heroB"), true),
      row(t("teachers.heroC"), false),
    ]),
  ]);
}

const RESULT_CELLS = [["12/15", "hi"], ["9/15", "mid"], ["–", "none"], ["14/15", "hi"]];

function resultsArt() {
  return el("div.teach-results", {}, [
    el("div.teach-results__grid", { "aria-hidden": "true" },
      RESULT_CELLS.map(([label, tone]) => el(`span.teach-results__cell.is-${tone}`, {}, label))),
    el("p.teach-results__caption", {}, [icon(ICONS.users, 13), t("teachers.f3caption")]),
  ]);
}

function features() {
  return featureSection("teachers", [["f1", assignArt], ["f2", composeArt], ["f3", resultsArt]]);
}

function steps() {
  return stepsSection("teachers.stepsTitle", ["teachers.s1", "teachers.s2", "teachers.s3"]);
}

function closer() {
  return el("section.lp-closer", {}, [
    el("div", {}, [
      el("h2.lp-h2", {}, t("teachers.closeTitle")),
      el("p.lp-sub", {}, t("teachers.closeBody")),
      el("p.lp-teachnote", {}, [
        t("teachers.studentNote"), " ",
        el("a", { href: "#/welcome" }, t("teachers.studentLink")),
      ]),
    ]),
    el("a.btn.btn--lg", { href: ctaHref() }, ctaLabel()),
  ]);
}

export function renderTeacherLanding() {
  return {
    title: t("teachers.pageTitle"),
    chrome: false,
    node: el("div.lp", {}, [
      header(),
      el("main.lp-main", { id: "main" }, [
        hero(),
        features(),
        steps(),
        closer(),
      ]),
      footer(),
    ]),
  };
}

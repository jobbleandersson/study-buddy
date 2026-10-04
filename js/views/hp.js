// Högskoleprovet prep hub at #/hp — a countdown to the user's prov, a live
// normed-score prognosis on the test's own 0,0–2,0 scale, the eight delprov laid
// out the way the test is (a verbal and a quantitative half), and one tap into a
// timed drill or the mini-mock. Stateless: recomputed from attempts / srs /
// settings on every visit, like exam-prep.js.
//
// HP's delprov sets are picked and added from right here, not from
// #/library — Högskoleprovet isn't a curriculum subject a student browses
// among Swedish/Biology/etc., it's a separate track with its own hub, so each
// delprov's own add button lives on its tile (see js/data/hp-content.js).

import { store } from "../store.js";
import { el, clear, icon, ICONS, toast } from "../lib/dom.js";
import { t, plural, daysUntil, getLang, sentenceCase } from "../lib/i18n.js";
import { homeButton } from "../components/nav.js";
import { foldedDatePicker } from "../components/calendar.js";
import { localDayKey } from "../lib/activity.js";
import { countdownLabel } from "../lib/date-phrases.js";
import { sparkline } from "../lib/spark.js";
import { weakSpotQuestions, firstTryCorrect } from "../lib/mastery.js";
import { loadHpIndex, loadHpTranslations, isHpImported, importHpSet } from "../data/hp-content.js";
import {
  normedScore, parseHpSetId, isHpSetId, attemptNormedTotal,
  DELPROV_ORDER, DELPROV_PACE, VERBAL_DELPROV, KVANT_DELPROV, partOf, buildHpPlan,
} from "../lib/hp.js";

const fmtN = (n) => (n == null ? "–" : Number(n).toFixed(2).replace(".", ","));
const fmt1 = (n) => Number(n).toFixed(1).replace(".", ",");
/** Where a normed score sits along the 0–2 scale, as a CSS length. */
const scalePos = (n) => `${(Math.max(0, Math.min(2, n)) / 2) * 100}%`;

/** The test's two halves, each with one colour used everywhere on the page:
 *  the score scale's markers, the half's heading and its delprov codes. */
const PART_COLOR = { verbal: "var(--brand)", kvant: "var(--c-tangerine)" };
const PART_INK = { verbal: "var(--brand-ink)", kvant: "var(--c-tangerine-ink)" };

function hpSets() {
  return store.assignments.filter((a) => isHpSetId(a.id));
}

const delprovCodeOf = (subjectId) => subjectId.replace(/^hp-/, "");

function hpSetOrder(index) {
  return index.sets.slice().sort(
    (a, b) => DELPROV_ORDER.indexOf(delprovCodeOf(a.subject)) - DELPROV_ORDER.indexOf(delprovCodeOf(b.subject))
  );
}

const locale = () => (getLang() === "sv" ? "sv-SE" : "en-GB");

/** Recency-weighted accuracy per delprov, read straight off HP attempt items
 *  (the delprov comes from each question's `variant`, not its topic).
 *  -> { [dp]: { rate, weight } } */
function delprovAccuracy() {
  const runs = store.attempts
    .filter((a) => a.hp && a.items && a.items.length)
    .sort((a, b) => (a.finishedAt || 0) - (b.finishedAt || 0));
  const acc = {};
  runs.forEach((run, idx) => {
    const w = Math.pow(0.5, (runs.length - 1 - idx) / 4);
    for (const it of run.items) {
      const v = store.findQuestion(it.questionId)?.question.variant;
      if (!v) continue;
      const e = acc[v] || (acc[v] = { num: 0, den: 0 });
      e.num += (firstTryCorrect(it) ? 1 : 0) * w;
      e.den += w;
    }
  });
  const out = {};
  for (const [dp, e] of Object.entries(acc)) out[dp] = { rate: e.den ? e.num / e.den : null, weight: e.den };
  return out;
}

/** Shrunk, weight-pooled accuracy for a half (verbal / kvant). Add-3 smoothing
 *  toward 0.5, so one perfect 12-question drill doesn't read as 80/80. null
 *  until at least a few questions in that half have been answered. */
function partRate(acc, list) {
  let c = 3, n = 6;
  for (const dp of list) {
    const e = acc[dp];
    if (!e || e.rate == null) continue;
    c += e.rate * e.weight;
    n += e.weight;
  }
  return n > 6 ? c / n : null;
}

/**
 * The live prognosis, also consumed by progress.js.
 * -> { verbal, kvant, total, history:[normed…] } or null when there's no HP
 *    attempt history to read.
 */
export function hpPrognosis() {
  const runs = store.attempts.filter((a) => a.hp);
  if (!runs.length) return null;

  const acc = delprovAccuracy();
  const vAcc = partRate(acc, VERBAL_DELPROV);
  const kAcc = partRate(acc, KVANT_DELPROV);
  if (vAcc == null && kAcc == null) return null;

  const res = normedScore({
    verbalRaw: (vAcc ?? 0) * 80, verbalTotal: vAcc != null ? 80 : 0,
    kvantRaw: (kAcc ?? 0) * 80, kvantTotal: kAcc != null ? 80 : 0,
    testId: null,
  });
  const history = runs
    .sort((a, b) => (a.finishedAt || 0) - (b.finishedAt || 0))
    .map(attemptNormedTotal)
    .filter((n) => n != null)
    .slice(-8);

  return { verbal: res.verbal, kvant: res.kvant, total: res.total, history };
}

function planDayWhen(offset, dayKey) {
  if (offset === 0) return t("exam.planToday");
  if (offset === 1) return t("exam.planTomorrow");
  try {
    return new Date(dayKey + "T00:00:00").toLocaleDateString(locale(), { weekday: "short", day: "numeric" });
  } catch { return dayKey.slice(5); }
}

/* ------------------------------------------------------------------ *
 * The overview: score on the 0,0–2,0 scale, the test day, what to do next
 * ------------------------------------------------------------------ */

/** The normed scale the real result is given on, with the estimate marked on
 *  it: a needle for the total, a dot each for the verbal and quantitative
 *  halves. Drawn empty (just the scale) before there's an estimate. */
function scoreScale(prog) {
  const marks = prog ? [
    el("span.hp-scale__fill", { style: { "--x": scalePos(prog.total) } }),
    prog.verbal != null ? el("span.hp-scale__dot", { style: { "--x": scalePos(prog.verbal), "--c": PART_COLOR.verbal } }) : null,
    prog.kvant != null ? el("span.hp-scale__dot", { style: { "--x": scalePos(prog.kvant), "--c": PART_COLOR.kvant } }) : null,
    el("span.hp-scale__needle", { style: { "--x": scalePos(prog.total) } }),
  ] : [];
  return el("div.hp-scale", {
    role: "img",
    "aria-label": prog
      ? t("hp.scaleAria", { total: fmtN(prog.total), v: fmtN(prog.verbal), k: fmtN(prog.kvant) })
      : t("hp.scaleEmptyAria"),
  }, [
    el("div.hp-scale__track", {}, marks.filter(Boolean)),
    el("div.hp-scale__labels", { "aria-hidden": "true" },
      [0, 0.5, 1, 1.5, 2].map((v) => el("span", { style: { "--x": scalePos(v) } }, fmt1(v)))),
  ]);
}

function scoreZone(prog) {
  const part = (key, v) => el("span.hp-part", { style: { "--c": PART_COLOR[key] } }, [
    el("i", { "aria-hidden": "true" }), t(`hp.${key}`), el("b", {}, fmtN(v)),
  ]);
  return el("div.hp-hero__score", {}, [
    el("p.hp-hero__label", {}, t("hp.reveal.eyebrow")),
    el("div.hp-hero__figure", {}, [
      prog ? el("strong.hp-hero__big", {}, fmtN(prog.total)) : el("strong.hp-hero__empty", {}, t("hp.noEstimate")),
      prog && prog.history.length >= 2
        ? el("div.hp-hero__trend", {}, [
            sparkline(prog.history, { max: 2, ariaLabel: t("hp.trendAria", { list: prog.history.map(fmtN).join(", ") }) }),
          ])
        : null,
    ].filter(Boolean)),
    scoreScale(prog),
    prog
      ? el("div.hp-hero__parts", {}, [part("verbal", prog.verbal), part("kvant", prog.kvant)])
      : el("p.hp-hero__hint", {}, t("hp.prognosisNone")),
    prog ? el("p.hp-hero__caption", {}, t("hp.prognosisCaption")) : null,
  ].filter(Boolean));
}

/** The test day as a small calendar page, or the picker to set it. */
function dateZone(hpDate, { editing, setEditing }) {
  if (hpDate && !editing) {
    const d = new Date(hpDate + "T00:00:00");
    const fmt = (opts) => { try { return d.toLocaleDateString(locale(), opts); } catch { return ""; } };
    return el("div.hp-hero__date", {}, [
      el("p.hp-hero__label", {}, t("hp.dayLabel")),
      el("div.hp-day", {}, [
        el("div.hp-day__page", { "aria-hidden": "true" }, [
          el("span.hp-day__month", {}, fmt({ month: "short" }).replace(".", "")),
          el("strong.hp-day__num", {}, String(d.getDate())),
          el("span.hp-day__wday", {}, fmt({ weekday: "short" }).replace(".", "")),
        ]),
        el("div.hp-day__txt", {}, [
          el("strong", {}, sentenceCase(countdownLabel(hpDate))),
          el("span", {}, fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" })),
          el("button.linkbtn.hp-day__edit", { type: "button", onclick: () => setEditing(true) }, t("hp.changeDate")),
        ]),
      ]),
    ]);
  }

  const datePick = foldedDatePicker({ label: t("hp.dateLabel"), min: localDayKey(), value: hpDate || "" });
  return el("div.hp-hero__date", {}, [
    el("p.hp-hero__label", {}, t("hp.dayLabel")),
    el("p.hp-hero__prompt", {}, t("hp.noDatePrompt")),
    el("div.hp-hero__pick", {}, [
      datePick.el,
      el("button.btn.btn--sm", {
        type: "button",
        onclick: () => {
          const day = datePick.getValue();
          // Nothing picked yet: open the calendar rather than "saving" an empty date.
          if (!day) { datePick.el.querySelector("details")?.setAttribute("open", ""); return; }
          if (store.setHpDate(day)) { toast(t("hp.dateSaved")); setEditing(false); }
        },
      }, [icon(ICONS.calendar, 16), t("hp.setDate")]),
      editing ? el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => setEditing(false) }, t("common.cancel")) : null,
    ].filter(Boolean)),
    editing && hpDate
      ? el("button.linkbtn.hp-day__edit", {
          type: "button",
          onclick: () => { store.setHpDate(null); toast(t("hp.dateCleared")); setEditing(false); },
        }, t("hp.clearDate"))
      : null,
  ].filter(Boolean));
}

/* ------------------------------------------------------------------ *
 * The delprov: eight tiles in the test's two halves. A tile only names the
 * delprov and how it's going; tapping it opens a small dialog that says what
 * the delprov is and offers the two ways to practise it. A delprov's set is
 * added to the student's library the first time they open it, so there's no
 * separate "add" step to understand first.
 * ------------------------------------------------------------------ */

/** A link that opens one of HP's sets at `hash`, adding the set to the library
 *  on the way when it isn't there yet. Once added it's an ordinary link. */
function setLink(tag, entry, hash, props, children) {
  return el(tag, {
    ...props, href: hash,
    onclick: async (e) => {
      const link = e.currentTarget;   // null again once the handler has awaited
      // Already adding it: a second tap must not start a second import of the same set.
      if (link.getAttribute("aria-busy") === "true") { e.preventDefault(); return; }
      if (isHpImported(entry.id)) return;
      e.preventDefault();
      link.setAttribute("aria-busy", "true");
      try {
        await importHpSet(entry);
      } catch {
        link.removeAttribute("aria-busy");
        toast(t("lib.addFail"));
        return;
      }
      location.hash = hash;
    },
  }, children);
}

/** The delprov's own set (the övningsprov, "lib-hp-<test>-<dp>") and anything
 *  else filed under it (the ORD word bank). */
function delprovSets(index, dp) {
  const entries = hpSetOrder(index).filter((s) => delprovCodeOf(s.subject) === dp);
  const main = entries.find((s) => parseHpSetId(s.id).test) || entries[0] || null;
  return { main, extras: entries.filter((s) => s !== main) };
}

let dpDialog = null;
function onDialogKey(e) { if (e.key === "Escape") closeDelprovDialog(); }

function closeDelprovDialog() {
  if (!dpDialog) return;
  const { node, opener } = dpDialog;
  dpDialog = null;
  node.remove();
  document.removeEventListener("keydown", onDialogKey);
  window.removeEventListener("hashchange", closeDelprovDialog);
  if (opener?.isConnected) opener.focus();
}

function openDelprovDialog(dp, { index, tr, acc }, opener) {
  closeDelprovDialog();
  const { main, extras } = delprovSets(index, dp);
  const part = partOf(dp);
  const pace = DELPROV_PACE[dp] || 12;
  const rate = isHpImported(main.id) ? acc[dp]?.rate : null;
  const count = plural(main.count, "common.questionOne", "common.questionMany");

  const node = el("div.modal", {
    role: "dialog", "aria-modal": "true", "aria-labelledby": "hp-dpd-title",
    onclick: (e) => { if (e.target === node) closeDelprovDialog(); },
  }, [
    el("div.modal__card.hp-dpd", { style: { "--c": PART_COLOR[part], "--c-ink": PART_INK[part] } }, [
      el("div.hp-dpd__head", {}, [
        el("span.hp-dpd__code", {}, t(`hp.delprov.${dp}`)),
        el("h3#hp-dpd-title", {}, t(`hp.name.${dp}`)),
        el("button.iconbtn.iconbtn--sm.hp-dpd__close", {
          type: "button", "aria-label": t("common.close"), onclick: closeDelprovDialog,
        }, [icon(ICONS.close, 18)]),
      ]),
      el("p.hp-dpd__desc", {}, t(`hp.about.${dp}`)),
      rate != null ? el("p.hp-dpd__last", {}, t("hp.soFar", { n: Math.round(rate * 100) })) : null,
      el("div.hp-dpd__choices", {}, [
        setLink("a.hp-dpd__choice.is-primary", main, `#/session/${main.id}?exam=1&min=${pace}`, {}, [
          icon(ICONS.clock, 20),
          el("span", {}, [el("strong", {}, t("hp.choiceTimed")), el("small", {}, t("hp.choiceTimedSub", { q: count, n: pace }))]),
        ]),
        setLink("a.hp-dpd__choice", main, `#/session/${main.id}`, {}, [
          icon(ICONS.play, 20),
          el("span", {}, [el("strong", {}, t("hp.choiceFree")), el("small", {}, t("hp.choiceFreeSub"))]),
        ]),
      ]),
      el("div.hp-dpd__more", {}, [
        ...extras.map((s) => setLink("a.linkbtn", s, `#/session/${s.id}`, {},
          [icon(ICONS.layers, 15), tr.sets[s.id]?.title || s.title])),
        setLink("a.linkbtn", main, `#/print/${main.id}`, {}, [icon(ICONS.fileText, 15), t("print.worksheet")]),
      ]),
    ].filter(Boolean)),
  ]);
  document.body.appendChild(node);
  dpDialog = { node, opener };
  document.addEventListener("keydown", onDialogKey);
  // A choice navigates away; the dialog goes with the page it was opened over.
  window.addEventListener("hashchange", closeDelprovDialog);
  node.querySelector(".hp-dpd__choice")?.focus();
}

function delprovTile(dp, ctx) {
  const { main } = delprovSets(ctx.index, dp);
  if (!main) return null;
  const rate = isHpImported(main.id) ? ctx.acc[dp]?.rate : null;
  const tile = el("button.hp-tile", { type: "button", "aria-haspopup": "dialog" }, [
    el("span.hp-tile__code", {}, t(`hp.delprov.${dp}`)),
    el("span.hp-tile__name", {}, t(`hp.name.${dp}`)),
    rate != null
      ? el("span.hp-tile__status", {}, t("hp.pctRight", { n: Math.round(rate * 100) }))
      : el("span.hp-tile__status.is-none", {}, t("hp.notPracticed")),
  ]);
  tile.onclick = () => openDelprovDialog(dp, ctx, tile);
  return tile;
}

function delprovBoard(index, tr, acc) {
  const ctx = { index, tr, acc };
  const group = (key, list) => el("section.hp-group", {
    style: { "--c": PART_COLOR[key], "--c-ink": PART_INK[key] }, "aria-labelledby": `hp-group-${key}`,
  }, [
    el("h3.hp-group__title", { id: `hp-group-${key}` }, [el("i", { "aria-hidden": "true" }), t(`hp.${key}`)]),
    el("div.hp-group__tiles", {}, list.map((dp) => delprovTile(dp, ctx)).filter(Boolean)),
  ]);

  return el("section.hp-board", { "aria-labelledby": "hp-board-title" }, [
    el("header.hp-board__head", {}, [el("h2#hp-board-title", {}, t("hp.boardTitle")), el("p", {}, t("hp.boardSub"))]),
    group("verbal", VERBAL_DELPROV),
    group("kvant", KVANT_DELPROV),
  ]);
}

/** A side panel with the Progress page's card head (icon, title, line under it). */
function sidePanel(iconPath, title, sub, body) {
  return el("section.set-card.pg-card", {}, [
    el("header.set-card__head", {}, [
      el("span.set-card__ic", { "aria-hidden": "true" }, icon(iconPath, 18)),
      el("div.pg-card__titles", {}, [el("h2", {}, title), sub ? el("p", {}, sub) : null].filter(Boolean)),
    ]),
    el("div.pg-card__body", {}, body.filter(Boolean)),
  ]);
}

export async function renderHp() {
  let index = null, tr = { subjects: {}, sets: {} };
  try {
    index = await loadHpIndex();
    tr = getLang() === "en" ? await loadHpTranslations() : { subjects: {}, sets: {} };
  } catch { /* the delprov board just won't render below; the overview doesn't need it */ }

  const root = el("div.hp-dash");
  const bodyEl = el("div.hp-dash__body");
  root.append(
    homeButton(),
    el("header.hp-dash__intro", {}, [el("h1", {}, t("hp.pageTitle")), el("p", {}, t("hp.lede"))]),
    bodyEl,
  );

  let editingDate = false;
  const setEditing = (on) => { editingDate = on; paint(); };

  function paint() {
    clear(bodyEl);
    const sets = hpSets();
    const hpDate = store.settings.hpDate || null;
    const acc = delprovAccuracy();
    const prog = hpPrognosis();

    // Practised delprov, weakest first.
    const rows = DELPROV_ORDER
      .filter((dp) => acc[dp] && acc[dp].rate != null && sets.some((s) => parseHpSetId(s.id).delprov === dp))
      .map((dp) => ({ dp, v: acc[dp].rate }))
      .sort((a, b) => a.v - b.v);
    const drillHash = (dp) => {
      const set = sets.find((s) => parseHpSetId(s.id).delprov === dp);
      return set ? `#/session/${set.id}?exam=1&min=${DELPROV_PACE[dp] || 12}` : "#/hp";
    };
    const dueN = store.dueQuestions().filter((d) => isHpSetId(d.assignment.id)).length;

    /* ---- overview: score, test day, next steps ---- */
    const nextSteps = [];
    if (rows.length) {
      nextSteps.push(el("a.btn", { href: drillHash(rows[0].dp) },
        [icon(ICONS.target, 16), t("hp.drillWeak", { delprov: t(`hp.delprov.${rows[0].dp}`) })]));
    }
    // The mini mock draws on every övningsprov; any not in the library yet are added on the way in,
    // so it's a first step that works before anything has been practised.
    const mockBtn = el("a.btn" + (rows.length ? ".btn--ghost" : ""), { href: "#/hp/mock", title: t("hp.mockTip") },
      [icon(ICONS.clock, 16), t("hp.mockStart")]);
    mockBtn.onclick = async (e) => {
      if (mockBtn.getAttribute("aria-busy") === "true") { e.preventDefault(); return; }
      const missing = index ? hpSetOrder(index).filter((s) => parseHpSetId(s.id).test && !isHpImported(s.id)) : [];
      if (!missing.length) return;
      e.preventDefault();
      mockBtn.setAttribute("aria-busy", "true");
      for (const s of missing) {
        try { await importHpSet(s); } catch { /* the mock uses whichever sets did load */ }
      }
      location.hash = "#/hp/mock";
    };
    nextSteps.push(mockBtn);
    const wordBank = index?.sets.find((s) => delprovCodeOf(s.subject) === "ord" && !parseHpSetId(s.id).test);
    if (wordBank) {
      nextSteps.push(setLink("a.btn.btn--ghost", wordBank, `#/session/${wordBank.id}`, {}, [icon(ICONS.layers, 16), t("hp.trainOrd")]));
    }
    if (dueN) {
      nextSteps.push(el("a.btn.btn--ghost", { href: "#/review" }, [icon(ICONS.spark, 16), plural(dueN, "hp.dueOne", "hp.dueMany")]));
    }
    bodyEl.appendChild(el("section.hp-hero", { "aria-label": t("hp.pageTitle") }, [
      el("div.hp-hero__main", {}, [scoreZone(prog), dateZone(hpDate, { editing: editingDate, setEditing })]),
      el("div.hp-hero__next", {}, nextSteps),
    ]));

    /* ---- the plan to test day, and what's weak ---- */
    const weak = weakSpotQuestions(sets, store.attempts);
    const weakTopics = [...new Set(weak.map((w) => w.question.topic))].slice(0, 6);
    const plan = buildHpPlan({
      hpDate,
      weakDelprov: rows.slice(0, 4).map((r) => r.dp),
      dueCount: dueN,
      softDelprov: rows.slice(4).map((r) => r.dp),
    });
    const side = [];
    if (plan) {
      const dayRows = plan.map((r) => {
        const label = r.kind === "drill" ? t("hp.planDrill", { delprov: t(`hp.delprov.${r.delprov}`) })
          : r.kind === "review" ? plural(r.n, "exam.planReviewOne", "exam.planReviewMany")
          : r.kind === "ord" ? t("hp.planOrd")
          : r.kind === "mock" ? t("hp.planMock")
          : r.kind === "reviewmiss" ? t("exam.planReviewMiss")
          : t("hp.planTestDay");
        const hash = r.kind === "drill" ? drillHash(r.delprov)
          : r.kind === "review" || r.kind === "reviewmiss" ? "#/review"
          : r.kind === "ord" ? drillHash("ord")
          : r.kind === "mock" ? "#/hp/mock" : null;
        return el("li.exam-prep__day" + (r.dayOffset === 0 ? ".is-today" : "") + (r.kind === "testday" ? ".is-test" : ""), {}, [
          el("span.exam-prep__day-when", {}, planDayWhen(r.dayOffset, r.dayKey)),
          el("span.exam-prep__day-task", {}, label),
          r.dayOffset === 0 && hash
            ? el("a.btn.btn--sm", { href: hash }, [t("exam.planStart"), icon(ICONS.arrow, 14)])
            : r.minutes ? el("span.exam-prep__day-min", {}, t("exam.planMin", { n: r.minutes })) : null,
        ].filter(Boolean));
      });
      // A long plan shows the next few days and the test day itself; the days between fold away.
      const SHOW = 5;
      if (dayRows.length > SHOW + 2) {
        const folded = dayRows.slice(SHOW, -1);
        folded.forEach((li) => { li.hidden = true; });
        const more = el("li.hp-plan__more", {}, [
          el("button.linkbtn", {
            type: "button",
            onclick: () => { folded.forEach((li) => { li.hidden = false; }); more.remove(); },
          }, t("hp.planShowAll", { n: dayRows.length })),
        ]);
        dayRows.splice(SHOW, 0, more);
      }
      side.push(sidePanel(ICONS.calendarCheck, t("hp.planTitle"), plural(daysUntil(hpDate), "exam.planDaysOne", "exam.planDaysMany"), [
        el("ol.exam-prep__days", {}, dayRows),
      ]));
    }
    if (weakTopics.length) {
      side.push(sidePanel(ICONS.target, t("hp.weakTitle"), t("hp.weakSub"), [
        el("ul.hp-weak", {}, weakTopics.map((topic) => el("li", {}, sentenceCase(topic)))),
      ]));
    }
    if (side.length) bodyEl.appendChild(el("div.hp-side" + (side.length > 1 ? ".is-two" : ""), {}, side));

    /* ---- the delprov ---- */
    if (index) bodyEl.appendChild(delprovBoard(index, tr, acc));
    else bodyEl.appendChild(el("section.panel", {}, [el("p", {}, t("lib.loadFailBody"))]));
  }

  paint();
  return { title: t("hp.pageTitle"), node: root };
}

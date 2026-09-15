// Högskoleprovet prep hub at #/hp — a countdown to the user's prov, a live
// normed-score prognosis, per-delprov readiness, and one tap into a timed
// drill or the mini-mock. Stateless: recomputed from attempts / srs / settings
// on every visit, like exam-prep.js.
//
// HP's delprov sets are picked and added from right here, not from
// #/library — Högskoleprovet isn't a curriculum subject a student browses
// among Swedish/Biology/etc., it's a separate track with its own hub, so its
// own "add a delprov" panel lives on this page (see js/data/hp-content.js).

import { store } from "../store.js";
import { el, clear, icon, ICONS, toast } from "../lib/dom.js";
import { t, plural, daysUntil, getLang, sentenceCase } from "../lib/i18n.js";
import { homeButton } from "../components/nav.js";
import { countdownLabel } from "../lib/date-phrases.js";
import { sparkline } from "../lib/spark.js";
import { weakSpotQuestions } from "../lib/mastery.js";
import { loadHpIndex, loadHpTranslations, isHpImported, importHpSet } from "../data/hp-content.js";
import {
  normedScore, parseHpSetId, isHpSetId, attemptNormedTotal,
  DELPROV_ORDER, DELPROV_PACE, VERBAL_DELPROV, KVANT_DELPROV, partOf, buildHpPlan,
} from "../lib/hp.js";

const fmtN = (n) => (n == null ? "–" : Number(n).toFixed(2).replace(".", ","));

function hpSets() {
  return store.assignments.filter((a) => isHpSetId(a.id));
}

const delprovCodeOf = (subjectId) => subjectId.replace(/^hp-/, "");

function hpSetOrder(index) {
  return index.sets.slice().sort(
    (a, b) => DELPROV_ORDER.indexOf(delprovCodeOf(a.subject)) - DELPROV_ORDER.indexOf(delprovCodeOf(b.subject))
  );
}

/** "ORD – Ordförståelse" -> "Ordförståelse": the code already has its own column. */
const afterDash = (s) => (s || "").split(/\s[–-]\s/).slice(1).join(" – ") || s || "";

/** Full delprov name for a subject id, in the UI language. */
function delprovName(index, tr, subjectId) {
  const en = tr.subjects?.[subjectId]?.name;
  const sv = (index.subjects || []).find((s) => s.id === subjectId)?.name;
  return afterDash(en || sv || "");
}

/** The student's most recent finished run of one set -> "8/10", or null. */
function lastResult(setId) {
  const run = store.attempts
    .filter((a) => a.assignmentId === setId && a.items?.length)
    .sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0))[0];
  if (!run) return null;
  return `${run.items.filter((i) => i.correct).length}/${run.items.length}`;
}

/** One delprov set as a table row: code, name, the numbers that matter for
 *  planning (questions, time, last result), then add — or study/exam/print
 *  once it's added. On a phone the number columns fold into a meta line. */
function hpSetRow(entry, index, tr, refresh) {
  const added = isHpImported(entry.id);
  const dp = delprovCodeOf(entry.subject);
  const title = tr.sets[entry.id]?.title || entry.title;
  const summary = tr.sets[entry.id]?.summary || entry.summary;
  const minutes = DELPROV_PACE[dp] || 12;
  const last = added ? lastResult(entry.id) : null;

  const actions = added
    ? [
        el("a.btn.btn--sm", { href: `#/session/${entry.id}` }, [icon(ICONS.play, 14), t("lib.study")]),
        el("button.btn.btn--ghost.btn--sm", {
          type: "button", title: t("lib.examTip"),
          onclick: () => { location.hash = `#/session/${entry.id}?exam=1`; },
        }, [icon(ICONS.clock, 14), t("lib.exam")]),
        el("a.iconbtn.iconbtn--sm", {
          href: `#/print/${entry.id}`, "aria-label": t("print.worksheet"), title: t("print.worksheet"),
        }, [icon(ICONS.fileText, 16)]),
      ]
    : [
        el("button.btn.btn--ghost.btn--sm", {
          type: "button",
          onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
              await importHpSet(entry);
              refresh();
            } catch {
              toast(t("lib.addFail"));
              btn.disabled = false;
            }
          },
        }, [icon(ICONS.plus, 14), t("lib.add")]),
      ];

  return el("tr.hp-table__row" + (added ? ".is-added" : ""), {}, [
    el("td.hp-table__code", {}, t(`hp.delprov.${dp}`)),
    el("td.hp-table__area", {}, [
      el("div.hp-table__name", {}, delprovName(index, tr, entry.subject)),
      // "ORD – övningsprov 1" -> "Övningsprov 1"; titles that don't lead with
      // the code ("Ordbank 1 – vanliga provord") are kept whole.
      el("div.hp-table__sub", { title: summary },
        sentenceCase(title.replace(new RegExp(`^${t(`hp.delprov.${dp}`)}\\s[–-]\\s`), ""))),
      el("div.hp-table__meta", {}, [
        plural(entry.count, "common.questionOne", "common.questionMany"),
        t("exam.planMin", { n: minutes }),
        last ? t("hp.lastResult", { score: last }) : null,
      ].filter(Boolean).join(" · ")),
    ]),
    el("td.hp-table__num", {}, String(entry.count)),
    el("td.hp-table__num.hp-table__muted", {}, t("exam.planMin", { n: minutes })),
    el("td.hp-table__num" + (last ? "" : ".hp-table__muted"), {}, last || "–"),
    el("td.hp-table__actions", {}, [el("div", {}, actions)]),
  ]);
}

/** The delprov picker/manager. Always lists every delprov set — added ones
 *  with their study/exam/print actions, missing ones with an add button.
 *  `hasAny` just switches the intro copy: the full "get started" framing
 *  before anything's added, or a compact heading once the hub has content. */
function hpAddPanel(index, tr, refresh, { hasAny = false } = {}) {
  const all = hpSetOrder(index);
  const missing = all.filter((s) => !isHpImported(s.id));
  const verbal = all.filter((s) => partOf(delprovCodeOf(s.subject)) === "verbal");
  const kvant = all.filter((s) => partOf(delprovCodeOf(s.subject)) === "kvant");

  const addAllBtn = missing.length
    ? el("button.btn.btn--sm", {
        type: "button",
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          for (const s of missing) {
            try { await importHpSet(s); } catch { /* skip the ones that fail, keep going */ }
          }
          refresh();
        },
      }, [icon(ICONS.plus, 16), t("lib.addAll", { n: missing.length })])
    : el("span.note", {}, t("hp.allAdded"));

  const group = (labelKey, sets) => sets.length ? [
    el("tr.hp-table__group", {}, [el("th", { colSpan: 6, scope: "rowgroup" }, t(labelKey))]),
    ...sets.map((s) => hpSetRow(s, index, tr, refresh)),
  ] : [];

  return el("section.panel", {}, [
    el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "start", gap: "12px", flexWrap: "wrap", marginBottom: hasAny ? "4px" : "6px" } }, [
      el("h3", {}, t(hasAny ? "hp.moreTitle" : "hp.addTitle")),
      addAllBtn,
    ]),
    hasAny ? null : el("p.note", {}, t("hp.addIntro")),
    el("div.hp-table-wrap", {}, [
      el("table.hp-table", {}, [
        el("thead", {}, [el("tr", {}, [
          el("th", { scope: "col" }, t("hp.colDelprov")),
          el("th", { scope: "col" }, t("hp.colArea")),
          el("th.hp-table__num", { scope: "col" }, t("hp.colQuestions")),
          el("th.hp-table__num", { scope: "col" }, t("hp.colTime")),
          el("th.hp-table__num", { scope: "col" }, t("hp.colLast")),
          el("th", { scope: "col" }, el("span.sr-only", {}, t("hp.colActions"))),
        ])]),
        el("tbody", {}, [...group("hp.verbal", verbal), ...group("hp.kvant", kvant)]),
      ]),
    ]),
  ].filter(Boolean));
}

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
      e.num += (it.correct ? 1 : 0) * w;
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
    return new Date(dayKey + "T00:00:00").toLocaleDateString(
      getLang() === "sv" ? "sv-SE" : "en-GB", { weekday: "short", day: "numeric" });
  } catch { return dayKey.slice(5); }
}

export async function renderHp() {
  let index = null, tr = { subjects: {}, sets: {} };
  try {
    index = await loadHpIndex();
    tr = getLang() === "en" ? await loadHpTranslations() : { subjects: {}, sets: {} };
  } catch { /* the add-panel just won't render below; the dashboard itself doesn't need it */ }

  const root = el("div.hp-dash");
  const bodyEl = el("div");
  root.appendChild(homeButton());
  root.appendChild(el("h1", {}, t("hp.pageTitle")));
  root.appendChild(bodyEl);

  function paint() {
    clear(bodyEl);
    const sets = hpSets();

    if (!sets.length) {
      if (index) bodyEl.appendChild(hpAddPanel(index, tr, paint));
      else bodyEl.appendChild(el("section.panel", {}, [el("p", {}, t("lib.loadFailBody"))]));
      return;
    }

    const hpDate = store.settings.hpDate || null;
    const acc = delprovAccuracy();
    const prog = hpPrognosis();

    /* ---- countdown / date ---- */
    const dateInput = el("input", { type: "date", value: hpDate || "", "aria-label": t("hp.setDate") });
    bodyEl.appendChild(el("section.panel.hp-dash__head", {}, [
      hpDate
        ? el("p.hp-dash__when", {}, [
            icon(ICONS.clock, 16), " ",
            t("hp.provIn", { when: countdownLabel(hpDate) }),
            el("button.linkbtn", {
              type: "button", style: { marginInlineStart: "10px" },
              onclick: () => { store.setHpDate(null); toast(t("hp.dateCleared")); paint(); },
            }, t("hp.clearDate")),
          ])
        : el("div", {}, [
            el("p.note", { style: { marginBottom: "9px" } }, t("hp.noDatePrompt")),
            el("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" } }, [
              dateInput,
              el("button.btn.btn--sm", {
                type: "button",
                onclick: () => {
                  if (store.setHpDate(dateInput.value)) { toast(t("hp.dateSaved")); paint(); }
                },
              }, [icon(ICONS.calendar, 16), t("hp.setDate")]),
            ]),
          ]),
    ]));

    /* ---- prognosis ---- */
    const prognosisBody = prog
      ? el("div", {}, [
          el("div.hp-dash__prognosis", {}, [
            el("div.hp-dash__big", {}, fmtN(prog.total)),
            el("div.hp-dash__split", {}, [
              el("div", {}, [t("hp.verbal"), " ", el("b", {}, fmtN(prog.verbal))]),
              el("div", {}, [t("hp.kvant"), " ", el("b", {}, fmtN(prog.kvant))]),
            ]),
          ]),
          prog.history.length >= 2
            ? sparkline(prog.history, { max: 2, ariaLabel: t("hp.trendAria", { list: prog.history.map(fmtN).join(", ") }) })
            : null,
          el("p.note", { style: { marginTop: "8px", fontStyle: "italic" } }, t("hp.prognosisCaption")),
        ].filter(Boolean))
      : el("p.note", {}, t("hp.prognosisNone"));
    bodyEl.appendChild(el("section.panel", {}, [
      el("h3", {}, t("hp.prognosisTitle")),
      prognosisBody,
    ]));

    /* ---- readiness bars, weakest first ---- */
    const rows = DELPROV_ORDER
      .filter((dp) => acc[dp] && acc[dp].rate != null)
      .map((dp) => ({ dp, v: acc[dp].rate }))
      .sort((a, b) => a.v - b.v);
    const drillHash = (dp) => {
      const set = sets.find((s) => parseHpSetId(s.id).delprov === dp);
      return set ? `#/session/${set.id}?exam=1&min=${DELPROV_PACE[dp] || 12}` : "#/hp";
    };
    bodyEl.appendChild(el("section.panel", {}, [
      el("h3", {}, t("hp.readinessTitle")),
      rows.length
        ? el("div.hp-readiness", {}, rows.map(({ dp, v }) => {
            const pct = Math.round(v * 100);
            return el("a.hp-readiness__row", { href: drillHash(dp) }, [
              el("span.hp-readiness__k", {}, t(`hp.delprov.${dp}`)),
              el("span.meter__track", { role: "img", "aria-label": t("hp.readinessAria", { delprov: t(`hp.delprov.${dp}`), pct }) },
                [el("span.meter__fill", { style: { width: `${pct}%`, "--subject": partOf(dp) === "verbal" ? "var(--brand)" : "var(--c-tangerine)" } })]),
              el("span.hp-readiness__n", {}, `${pct}%`),
            ]);
          }))
        : el("p.note", {}, t("hp.readinessNone")),
    ]));

    /* ---- weak skills + due ---- */
    const weak = weakSpotQuestions(sets, store.attempts);
    const weakTopics = [...new Set(weak.map((w) => w.question.topic))].slice(0, 5);
    const dueN = store.dueQuestions().filter((d) => isHpSetId(d.assignment.id)).length;
    if (weakTopics.length || dueN) {
      bodyEl.appendChild(el("section.panel", {}, [
        el("h3", {}, t("hp.weakTitle")),
        weakTopics.length
          ? el("p.note", {}, weakTopics.map(sentenceCase).join(" · "))
          : el("p.note", {}, t("hp.weakNone")),
        dueN
          ? el("a.linkbtn", { href: "#/review", style: { marginTop: "8px", display: "inline-flex" } },
              [icon(ICONS.spark, 13), " ", plural(dueN, "hp.dueOne", "hp.dueMany")])
          : null,
      ].filter(Boolean)));
    }

    /* ---- dated plan ---- */
    const plan = buildHpPlan({
      hpDate,
      weakDelprov: rows.slice(0, 4).map((r) => r.dp),
      dueCount: dueN,
      softDelprov: rows.slice(4).map((r) => r.dp),
    });
    if (plan) {
      bodyEl.appendChild(el("section.panel.exam-prep__plan", {}, [
        el("div.exam-prep__mastery-head", {}, [
          el("span", {}, t("hp.planTitle")),
          el("span.exam-prep__pct", {}, plural(daysUntil(hpDate), "exam.planDaysOne", "exam.planDaysMany")),
        ]),
        el("ol.exam-prep__days", {}, plan.map((r) => {
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
        })),
      ]));
    }

    /* ---- actions ---- */
    const totalQ = sets.reduce((n, a) => n + a.questions.length, 0);
    bodyEl.appendChild(el("section.panel.exam-prep__actions", {}, [
      rows.length
        ? el("a.btn", { href: drillHash(rows[0].dp) },
            [icon(ICONS.target, 16), t("hp.drillWeak", { delprov: t(`hp.delprov.${rows[0].dp}`) })])
        : null,
      totalQ >= 10
        ? el("a.btn.btn--ghost", { href: "#/hp/mock" }, [icon(ICONS.clock, 16), t("hp.miniMock")])
        : el("p.note", {}, t("hp.mockTooFew")),
      sets.some((s) => parseHpSetId(s.id).delprov === "ord")
        ? el("a.btn.btn--ghost", { href: drillHash("ord") }, [icon(ICONS.layers, 16), t("hp.trainOrd")])
        : null,
    ].filter(Boolean)));

    /* ---- manage delprov ---- */
    if (index) bodyEl.appendChild(hpAddPanel(index, tr, paint, { hasAny: true }));
  }

  paint();
  return { title: t("hp.pageTitle"), node: root };
}

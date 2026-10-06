// Progress dashboard (#/progress): four key figures, a 20-week activity map
// shaded by how much you studied each day, level per subject, and what's due
// for review — plus the achievements, recall-trend and Högskoleprovet cards.

import { store } from "../store.js";
import { el, icon, ICONS } from "../lib/dom.js";
import { renderRich } from "../lib/rich.js";
import { clozeToUnderscores } from "../components/questions.js";
import { masteryByTopic, masteryForSubject, weakSpotQuestions } from "../lib/mastery.js";
import { reviewReason } from "../lib/srs.js";
import { localDayKey, addDays, recentDays, questionsAnsweredToday, reviewAccuracyTrend } from "../lib/activity.js";
import { t, plural, getLang, fmtDecimal } from "../lib/i18n.js";
import { goalRing } from "../components/goal-ring.js";
import { homeButton } from "../components/nav.js";
import { pageHead } from "../components/set-ui.js";
import { ACHIEVEMENTS, nextAchievement } from "../lib/achievements.js";
import { estimatedGrade } from "../lib/grade.js";
import { sparkline } from "../lib/spark.js";
import { hpPrognosis } from "./hp.js";
import { isHpSetId } from "../lib/hp.js";

const DUE_SHOWN = 8;
const HEAT_WEEKS = 20;

export function renderProgress() {
  const attempts = store.attempts;
  const tm = masteryByTopic(attempts);
  const today = localDayKey();
  const { freezes, atRisk, displayStreak, bestStreak, nextFreezeIn } = store.streakInfo;
  const studied = new Set(store.state.activity.daysStudied);
  const frozen = new Set(store.state.activity.frozenDays);

  // Questions answered per local day — shades the activity map.
  const perDay = new Map();
  for (const at of attempts) {
    if (!at.finishedAt || !at.items?.length) continue;
    const k = localDayKey(new Date(at.finishedAt));
    perDay.set(k, (perDay.get(k) || 0) + at.items.length);
  }

  // ---- key figures ----
  const goal = Number(store.settings.dailyGoal) || 0;
  const answeredToday = questionsAnsweredToday(attempts);
  const last30 = new Set(recentDays(30));
  const days30 = [...studied].filter((d) => last30.has(d)).length;
  let right = 0, graded = 0;
  for (const at of attempts) {
    if (!at.finishedAt || !last30.has(localDayKey(new Date(at.finishedAt)))) continue;
    for (const it of at.items || []) {
      if (typeof it.correct !== "boolean") continue;
      graded++;
      if (it.correct) right++;
    }
  }
  const accuracy = graded ? Math.round((right / graded) * 100) : null;

  const kpis = el("div.pg-kpis", {}, [
    kpi(atRisk ? ICONS.shield : ICONS.flame, "var(--c-tangerine)", t("prog.kpiStreak"),
      plural(displayStreak, "prog.streakDaysOne", "prog.streakDaysMany"),
      [
        bestStreak > displayStreak ? t("prog.kpiBest", { n: bestStreak }) : null,
        freezes > 0 ? el("span.pg-chip", { title: t("streak.freezeHelp") }, [icon(ICONS.shield, 12), `×${freezes}`]) : null,
        freezes === 0 && displayStreak > 0 && nextFreezeIn > 0
          ? el("span.pg-help", { title: t("streak.freezeHelp") }, plural(nextFreezeIn, "streak.freezeNextOne", "streak.freezeNext"))
          : null,
      ], { warn: atRisk }),
    kpi(ICONS.target, "var(--brand)", t("prog.kpiToday"),
      goal > 0 ? `${answeredToday} / ${goal}` : String(answeredToday),
      [goal > 0
        ? (answeredToday >= goal ? t("prog.kpiGoalDone") : t("prog.kpiTodayGoal"))
        : t("prog.kpiTodayNoGoal")],
      { side: goal > 0 ? goalRing(answeredToday, goal) : null }),
    kpi(ICONS.calendarCheck, "var(--ok)", t("prog.kpiDays"),
      `${days30} / 30`, [t("prog.kpiDaysSub", { n: studied.size })]),
    kpi(ICONS.check, "var(--c-grape)", t("prog.kpiAccuracy"),
      accuracy == null ? "–" : `${accuracy} %`,
      [accuracy == null ? t("prog.kpiAccuracyNone") : t("prog.kpiAccuracySub", { n: graded })]),
  ]);

  // ---- activity map ----
  const activity = panel(ICONS.calendar, t("prog.activityTitle"), t("prog.activitySub"), [
    atRisk ? el("p.note.note--warn", {}, t("streak.atRisk", { n: displayStreak })) : null,
    heatmap(today, studied, frozen, perDay),
    el("p.pg-foot", {}, attempts.length === 0 ? t("prog.firstHint") : t("prog.summary", {
      days: plural(studied.size, "prog.daysOne", "prog.daysMany"),
      sessions: plural(attempts.length, "prog.sessionsOne", "prog.sessionsMany"),
    }) + (bestStreak > 0 ? " · " + plural(bestStreak, "prog.personalBestOne", "prog.personalBest") : "")),
  ]);

  // ---- review, at a glance ----
  const dueItems = store.dueQuestions();
  const review = panel(ICONS.clock, t("prog.due"), null, [
    el("div.pg-big", {}, [
      el("strong", {}, String(dueItems.length)),
      el("span", {}, plural(dueItems.length, "prog.dueWaitingOne", "prog.dueWaitingMany")),
    ]),
    el("p.note", {}, dueItems.length ? t("prog.reviewExplain") : t("prog.nothingDue")),
    dueItems.length ? el("a.btn.btn--sm.pg-fullbtn", { href: "#/review" }, [icon(ICONS.spark, 16), t("prog.reviewToday")]) : null,
  ]);

  // ---- achievements ----
  const unlockedMap = store.unlockedAchievements;
  const got = ACHIEVEMENTS.filter((a) => a.id in unlockedMap).length;
  const next = nextAchievement(store.state);
  const achievements = panel(ICONS.trophy, t("ach.teaserTitle"), t("ach.subtitle", { unlocked: got, total: ACHIEVEMENTS.length }), [
    el("div.pg-bar", { role: "img", "aria-label": t("ach.subtitle", { unlocked: got, total: ACHIEVEMENTS.length }) },
      [el("i", { style: { width: "0%" }, dataset: { w: Math.round((got / ACHIEVEMENTS.length) * 100) } })]),
    el("p.note", {}, next
      ? t("ach.teaserNext", { desc: `${t(next.def.nameKey)} · ${t(next.def.descKey, { n: next.def.target })} (${next.have}/${next.need})` })
      : t("ach.teaserAllDone")),
  ], { actions: [el("a.linkbtn.pg-more", { href: "#/achievements" }, [t("prog.seeAll"), icon(ICONS.arrow, 14)])] });

  // ---- recall trend + Högskoleprovet ----
  const recall = reviewAccuracyTrend(attempts);
  const recallCard = recall.length >= 3 ? panel(ICONS.chart, t("prog.recallTitle"), t("prog.recallSub", { n: recall.length }), [
    sparkline(recall.map((d) => d.pct), {
      ariaLabel: t("prog.recallAria", { list: recall.map((d) => `${d.pct}%`).join(", ") }),
    }),
  ]) : null;

  // ---- level per subject ----
  const weakCount = weakSpotQuestions(store.assignments, attempts).length;
  const subjects = subjectRows(tm, attempts);
  const mastery = panel(ICONS.graduation, t("prog.mastery"), null, [
    subjects.length ? el("div.pg-subjects", {}, subjects) : el("p.pg-empty", {}, t("prog.masteryEmpty")),
    subjects.length ? el("p.pg-foot", {}, t("prog.gradeExplain")) : null,
  ], {
    actions: [
      subjects.length ? el("a.btn.btn--ghost.btn--sm", { href: "#/exam-prep" }, [icon(ICONS.graduation, 16), t("nav.examPrep")]) : null,
      // Only offered once there's enough history to know what "weak" means.
      weakCount ? el("a.btn.btn--sm", { href: "#/practice-weak" }, [icon(ICONS.target, 16), t("prog.practiseWeak")]) : null,
    ],
  });

  // ---- what's due, grouped by set ----
  const dueList = dueItems.length ? panel(ICONS.layers, t("prog.dueListTitle"), null, [
    el("div.pg-due", {}, dueGroups(dueItems.slice(0, DUE_SHOWN))),
    dueItems.length > DUE_SHOWN ? el("p.pg-foot", {}, t("prog.moreDue", { n: dueItems.length - DUE_SHOWN })) : null,
  ], { actions: [el("a.btn.btn--ghost.btn--sm", { href: "#/review" }, [icon(ICONS.spark, 16), t("prog.reviewAll")])] }) : null;

  const node = el("div.dash.pg", {}, [
    homeButton({ grid: true }),
    pageHead(t("prog.title"), t("prog.lede")),
    kpis,
    el("div.pg-grid", {}, [
      el("div.pg-col", {}, [activity, mastery]),
      el("div.pg-col", {}, [review, achievements, recallCard, hpPrognosisPanel()].filter(Boolean)),
    ]),
    dueList,
    el("a.btn.btn--ghost.pageback", { href: "#/", style: { justifySelf: "start" } }, [icon(ICONS.back, 16), t("common.backToMenu")]),
  ].filter(Boolean));

  requestAnimationFrame(() => {
    node.querySelectorAll("[data-w]").forEach((f) => { f.style.width = `${f.dataset.w}%`; });
    // On a narrow screen the map scrolls sideways — start at this week.
    node.querySelectorAll(".pg-heat__scroll").forEach((sc) => { sc.scrollLeft = sc.scrollWidth; });
  });

  return { title: t("common.progress"), node };
}

/** A card: icon, title, optional subtitle and actions, then the body. */
function panel(iconPath, title, sub, body, { actions = null } = {}) {
  const acts = (actions || []).filter(Boolean);
  return el("section.set-card.pg-card", {}, [
    el("header.set-card__head", {}, [
      el("span.set-card__ic", { "aria-hidden": "true" }, icon(iconPath, 18)),
      el("div.pg-card__titles", {}, [el("h2", {}, title), sub ? el("p", {}, sub) : null].filter(Boolean)),
      acts.length ? el("div.pg-card__actions", {}, acts) : null,
    ].filter(Boolean)),
    el("div.pg-card__body", {}, body.filter(Boolean)),
  ]);
}

/** One key figure: label, big value, a line of context. */
function kpi(iconPath, tone, label, value, sub, { side = null, warn = false } = {}) {
  return el("div.pg-kpi" + (warn ? ".is-warn" : ""), { style: { "--k": tone } }, [
    el("div.pg-kpi__main", {}, [
      el("p.pg-kpi__label", {}, [el("span.pg-kpi__ic", { "aria-hidden": "true" }, icon(iconPath, 14)), label]),
      el("strong.pg-kpi__value", {}, value),
      el("p.pg-kpi__sub", {}, sub.filter(Boolean).flatMap((x, i) => (i ? [" · ", x] : [x]))),
    ]),
    side,
  ].filter(Boolean));
}

/** HEAT_WEEKS weeks, Monday on top, oldest week left; each day shaded by how many
 *  questions you answered, protected (streak-freeze) days in blue. */
function heatmap(today, studied, frozen, perDay) {
  const locale = getLang() === "sv" ? "sv-SE" : "en-GB";
  const mondayIdx = (new Date().getDay() + 6) % 7;     // Mon=0 … Sun=6
  const keys = recentDays(mondayIdx + (HEAT_WEEKS - 1) * 7 + 1, today);
  const weeks = Math.ceil(keys.length / 7);
  const parse = (k) => new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)));
  const level = (n) => (n >= 50 ? 4 : n >= 25 ? 3 : n >= 10 ? 2 : 1);

  const cells = keys.map((k) => {
    const n = perDay.get(k) || 0;
    const date = parse(k).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
    const fz = frozen.has(k);
    const lv = fz ? 0 : n ? level(n) : studied.has(k) ? 1 : 0;
    const tip = fz ? t("prog.dayFrozen", { date }) : n ? plural(n, "prog.dayQuestionsOne", "prog.dayQuestionsMany", { date })
      : studied.has(k) ? t("prog.dayStudied", { date }) : t("prog.dayNone", { date });
    return el("i.pg-heat__cell" + (fz ? ".is-frozen" : lv ? `.lv${lv}` : "") + (k === today ? ".is-today" : ""), { title: tip });
  });

  // A month name over the first week that starts in it.
  const months = [];
  for (let w = 0; w < weeks; w++) {
    const k = keys[w * 7];
    const prev = w ? keys[(w - 1) * 7] : null;
    const label = !prev || k.slice(5, 7) !== prev.slice(5, 7)
      ? parse(k).toLocaleDateString(locale, { month: "short" }).replace(".", "") : "";
    months.push(el("span", {}, label));
  }
  const monday = parse(addDays(today, -mondayIdx));
  const dayName = (i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)
    .toLocaleDateString(locale, { weekday: "short" }).replace(".", "");

  return el("div.pg-heat", { role: "img", "aria-label": t("prog.activitySub") }, [
    el("div.pg-heat__scroll", {}, [
      el("div.pg-heat__grid", { style: { "--weeks": String(weeks) } }, [
        el("span.pg-heat__corner"),
        el("div.pg-heat__months", {}, months),
        el("div.pg-heat__days", {}, [0, 1, 2, 3, 4, 5, 6].map((i) => el("span", {}, i % 2 === 0 ? dayName(i) : ""))),
        el("div.pg-heat__cells", {}, cells),
      ]),
    ]),
    el("div.pg-heat__legend", {}, [
      el("span", {}, t("prog.legendLess")),
      ...[0, 1, 2, 3, 4].map((lv) => el("i.pg-heat__cell" + (lv ? `.lv${lv}` : ""))),
      el("span", {}, t("prog.legendMore")),
      el("i.pg-heat__cell.is-frozen.pg-heat__gap"),
      el("span", {}, t("prog.legendFrozen")),
    ]),
  ]);
}

/** Level per subject, weakest first: name, bar in the subject's colour,
 *  percent and an estimated grade. */
function subjectRows(tm, attempts) {
  // The latest real per-set attempt per subject — shown next to the long-term
  // level, so "69%" doesn't read as contradicting the 88% just scored.
  const lastBySubject = {};
  for (const at of attempts) {
    if (!at.items?.length) continue;
    const sid = store.getAssignment(at.assignmentId)?.subjectId;
    if (!sid) continue;
    const prev = lastBySubject[sid];
    if (!prev || (at.finishedAt || 0) > (prev.finishedAt || 0)) lastBySubject[sid] = at;
  }
  // Högskoleprovet has its own 0–2.0 scale on #/hp — an E–A level means nothing there.
  const hpSubjectIds = new Set(store.assignments.filter((a) => isHpSetId(a.id)).map((a) => a.subjectId));

  return store.subjects
    .filter((s) => !hpSubjectIds.has(s.id))
    .map((s) => ({ s, m: masteryForSubject(s.id, store.assignments, tm) }))
    .filter((x) => x.m != null)
    .sort((a, b) => a.m - b.m)
    .map(({ s, m }) => {
      const color = store.subjectColor(s.id);
      const pct = Math.round(m * 100);
      const grade = estimatedGrade(m);
      const last = lastBySubject[s.id];
      return el("div.pg-subj", {}, [
        el("span.pg-subj__dot", { style: { background: color.solid }, "aria-hidden": "true" }),
        el("div.pg-subj__name", {}, [
          el("strong", {}, s.name),
          el("small", {}, [
            last ? el("span", { title: t("prog.masteryVsScore", { score: last.scorePct }) }, t("prog.lastScore", { score: last.scorePct })) : null,
            // A near-mastered subject earns a victory lap: explain it back.
            m >= 0.8 ? el("a.linkbtn", { href: `#/teachback/${s.id}` }, [icon(ICONS.spark, 12), t("teach.tile")]) : null,
          ].filter(Boolean)),
        ]),
        el("div.pg-subj__track", { role: "img", "aria-label": t("prog.masteryAria", { subject: s.name, pct }) },
          [el("i", { style: { width: "0%", background: color.solid }, dataset: { w: pct } })]),
        el("span.pg-subj__pct", {}, `${pct} %`),
        el("span.gradepill" + `.gradepill--${grade.tier}`, { title: t("prog.gradeTooltip", { letter: grade.letter }) }, grade.letter),
      ]);
    });
}

/** The due questions under a heading per set (its subject's colour, how
 *  many), each on one line with why it's due as a small tag. */
function dueGroups(items) {
  const groups = new Map();
  for (const it of items) {
    if (!groups.has(it.assignment.id)) groups.set(it.assignment.id, { assignment: it.assignment, rows: [] });
    groups.get(it.assignment.id).rows.push(it);
  }
  return [...groups.values()].map(({ assignment, rows }) => el("section.pg-dgroup", {}, [
    el("header.pg-dgroup__head", {}, [
      el("span.pg-subj__dot", { style: { background: store.subjectColor(assignment.subjectId).solid }, "aria-hidden": "true" }),
      el("strong", {}, assignment.title),
      el("span", {}, plural(rows.length, "prog.qCountOne", "prog.qCountMany")),
    ]),
    ...rows.map(({ question, rec }) => {
      const p = question.kind === "cloze" ? clozeToUnderscores(question.prompt) : question.prompt;
      const why = reviewReason(rec);
      return el("div.pg-drow", {}, [
        // Shortened by CSS (one line), not by slicing — a cut could split a formula.
        el("span.pg-drow__q", { html: renderRich(p) }),
        why ? el("span.pg-drow__why.is-" + reasonTone(rec), {}, why) : null,
      ].filter(Boolean));
    }),
  ]));
}

/** The tag's tone, matching reviewReason(): missed → red, overdue → amber,
 *  well learned → green, first review → neutral. */
function reasonTone(rec, now = Date.now()) {
  if (rec.lapses > 0 && rec.reps <= 2) return "missed";
  if (Math.floor((now - rec.dueAt) / 864e5) >= 7) return "late";
  if (rec.reps >= 4) return "solid";
  return "plain";
}

/** "Högskoleprovet-prognos" — current verbal/kvant/total estimate plus a trend
 *  of past HP attempts. hpPrognosis() is null without HP attempts, so the card
 *  is absent for students who don't do HP. */
function hpPrognosisPanel() {
  const p = hpPrognosis();
  if (!p) return null;
  return panel(ICONS.award, t("hp.prognosisTitle"), t("hp.reveal.split", { v: fmtNormed(p.verbal), k: fmtNormed(p.kvant) }), [
    el("div.pg-big", {}, [el("strong", {}, fmtNormed(p.total)), el("span", {}, t("prog.hpTotal"))]),
    p.history.length >= 2
      ? sparkline(p.history, { max: 2, ariaLabel: t("hp.trendAria", { list: p.history.map(fmtNormed).join(", ") }) })
      : null,
  ], { actions: [el("a.linkbtn.pg-more", { href: "#/hp" }, [t("prog.seeAll"), icon(ICONS.arrow, 14)])] });
}

function fmtNormed(n) {
  return n == null ? "–" : fmtDecimal(n, 2);
}

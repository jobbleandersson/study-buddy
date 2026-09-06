// Exam prep. `#/exam-prep` is a subject picker; `#/exam-prep/:id` is the
// per-subject dashboard — the countdown to your test, where you stand, your
// weak spots, and two actions (drill weak spots / timed mock exam).
// Composed entirely from existing helpers; no new persisted state — it
// recomputes from dueAt / mastery / attempts / the srs map on every visit.

import { store } from "../store.js";
import { el, icon, ICONS } from "../lib/dom.js";
import { t, plural, daysUntil, getLang } from "../lib/i18n.js";
import { localDayKey, addDays } from "../lib/activity.js";
import { homeButton } from "../components/nav.js";
import { countdownLabel } from "../lib/date-phrases.js";
import {
  masteryByTopic, masteryForSubject, masteryForAssignment, weakSpotQuestions,
} from "../lib/mastery.js";

const MOCK_LENGTHS = [20, 40, 60];
const MOCK_COUNT = 20;
const MOCK_MIN_QUESTIONS = 5;

const PLAN_MINUTES = { drill: 25, review: 15, practice: 20, mock: 40, reviewmiss: 15, testday: 0 };

/**
 * A day-by-day study plan from today to the test — laid out from the same
 * weak-spots / review-schedule / mastery signals the rest of the page shows.
 * Stateless: rebuilt on every visit, so doing a session today shifts
 * tomorrow's plan on its own. null when the test is today/past or > ~6 weeks
 * out, or there's genuinely nothing to practise.
 */
function buildExamPlan({ subjectId, subjectName, sets, weak, dueCount, testSet, tm }) {
  if (!testSet?.dueAt) return null;
  const D = daysUntil(testSet.dueAt);
  if (D < 1 || D > 45) return null;

  const weakTopics = [...new Set(weak.map((w) => w.question.topic))].slice(0, 4);
  const softestSets = [...sets]
    .sort((a, b) => (masteryForAssignment(a, tm) ?? 1) - (masteryForAssignment(b, tm) ?? 1))
    .slice(0, 3);

  const rotate = [];
  for (const topic of weakTopics) rotate.push({ kind: "drill", topic, hash: `#/practice-weak?subject=${subjectId}` });
  if (dueCount) rotate.push({ kind: "review", n: dueCount, hash: "#/review" });
  for (const a of softestSets) rotate.push({ kind: "practice", title: a.title, hash: `#/session/${a.id}` });
  if (!rotate.length && sets[0]) rotate.push({ kind: "practice", title: sets[0].title, hash: `#/session/${sets[0].id}` });
  if (!rotate.length) return null;

  const today = localDayKey();
  const rows = [];
  let rp = 0;
  for (let d = 0; d <= D; d++) {
    let task;
    if (d === D) task = { kind: "testday" };
    else if (d === D - 1 && D >= 2) task = { kind: "reviewmiss", hash: "#/review" };
    else if (d === D - 2 && D >= 3) task = { kind: "mock", hash: `#/national/mix/${subjectId}?exam=1&min=40&count=${MOCK_COUNT}` };
    else { task = rotate[rp % rotate.length]; rp++; }
    rows.push({ dayOffset: d, dayKey: addDays(today, d), minutes: PLAN_MINUTES[task.kind], ...task });
  }
  return rows;
}

function planDayWhen(offset, dayKey) {
  if (offset === 0) return t("exam.planToday");
  if (offset === 1) return t("exam.planTomorrow");
  try {
    return new Date(dayKey + "T00:00:00").toLocaleDateString(
      getLang() === "sv" ? "sv-SE" : "en-GB", { weekday: "short", day: "numeric" });
  } catch { return dayKey.slice(5); }
}

export function renderExamPrep(subjectId) {
  if (!subjectId) return renderLanding();

  const subject = store.subjects.find((s) => s.id === subjectId);
  if (!subject) return emptyScreen(t("exam.noSubject"));

  const sets = store.assignments.filter((a) => a.subjectId === subjectId);
  const heading = `${subject.name} — ${t("exam.pageTitle")}`;

  if (!sets.length) {
    return {
      title: heading,
      node: el("div.exam-prep", {}, [
        homeButton(),
        el("h1", {}, heading),
        el("section.panel", {}, [
          el("p", {}, t("exam.noSets", { subject: subject.name })),
          el("a.btn", { href: "#/library", style: { marginTop: "12px" } },
            [icon(ICONS.book, 16), t("exam.addFromLibrary")]),
        ]),
      ]),
    };
  }

  const tm = masteryByTopic(store.attempts);
  const color = store.subjectColor(subjectId);

  /* ---- countdown ---- */
  const testSet = store.upcomingDue().find((a) => a.subjectId === subjectId && a.type === "test");
  const head = el("section.panel.exam-prep__head", {}, [
    testSet
      ? el("p.exam-prep__when", {}, [
          icon(ICONS.clock, 16), " ",
          t("exam.testIn", { subject: subject.name, when: countdownLabel(testSet.dueAt) }),
        ])
      : el("p.note", {}, `${t("exam.noDate")} ${t("exam.setDateHint")}`),
  ]);

  /* ---- where you stand: subject % in the heading, a per-topic breakdown
     below (weakest first — that's what prep should point at) ---- */
  const m = masteryForSubject(subjectId, store.assignments, tm);
  const pct = m == null ? null : Math.round(m * 100);
  const topicRows = [...new Set(
    sets.flatMap((a) => (a.questions || []).map((q) => q.topic).filter(Boolean))
  )]
    .map((topic) => ({ topic, mv: tm[topic] }))
    .filter((r) => r.mv != null)
    .sort((a, b) => a.mv - b.mv);

  const masteryPanel = el("section.panel", {}, [
    el("h3.exam-prep__mastery-head", {}, [
      el("span", {}, t("exam.masteryHeading", { subject: subject.name })),
      pct != null ? el("span.exam-prep__pct", {}, `${pct}%`) : null,
    ].filter(Boolean)),
    topicRows.length
      ? el("div.exam-prep__topics", {}, topicRows.map(({ topic, mv }) => {
          const tp = Math.round(mv * 100);
          return el("div.meter", {}, [
            el("span", { style: { textTransform: "capitalize" } }, topic),
            el("div.meter__track", {
              role: "img", "aria-label": t("prog.masteryAria", { subject: topic, pct: tp }),
            }, [el("div.meter__fill", { style: { width: `${tp}%`, "--subject": color.solid } })]),
            el("span.tabular", { style: { textAlign: "right", fontWeight: "700" } }, `${tp}%`),
          ]);
        }))
      : el("p.note", {}, t("exam.masteryUnknown")),
  ]);

  /* ---- weak spots ---- */
  const weak = weakSpotQuestions(sets, store.attempts);
  const dueN = store.dueQuestions().filter((d) => d.assignment.subjectId === subjectId).length;
  const weakTopics = [...new Set(weak.map((w) => w.question.topic))].slice(0, 4);

  /* ---- the plan: today → test day ---- */
  const plan = buildExamPlan({ subjectId, subjectName: subject.name, sets, weak, dueCount: dueN, testSet, tm });
  const planPanel = plan ? el("section.panel.exam-prep__plan", {}, [
    el("div.exam-prep__mastery-head", {}, [
      el("span", {}, t("exam.planTitle")),
      el("span.exam-prep__pct", {}, plural(daysUntil(testSet.dueAt), "exam.planDaysOne", "exam.planDaysMany")),
    ]),
    el("p.note", { style: { margin: "2px 0 4px" } }, t("exam.planSub")),
    el("ol.exam-prep__days", {}, plan.map((r) => {
      const label = r.kind === "drill" ? t("exam.planDrill", { topic: r.topic })
        : r.kind === "review" ? plural(r.n, "exam.planReviewOne", "exam.planReviewMany")
        : r.kind === "practice" ? t("exam.planPractice", { title: r.title })
        : r.kind === "mock" ? t("exam.planMock")
        : r.kind === "reviewmiss" ? t("exam.planReviewMiss")
        : t("exam.planTestDay", { subject: subject.name });
      return el("li.exam-prep__day" + (r.dayOffset === 0 ? ".is-today" : "") + (r.kind === "testday" ? ".is-test" : ""), {}, [
        el("span.exam-prep__day-when", {}, planDayWhen(r.dayOffset, r.dayKey)),
        el("span.exam-prep__day-task", {}, label),
        r.dayOffset === 0 && r.hash
          ? el("a.btn.btn--sm", { href: r.hash }, [t("exam.planStart"), icon(ICONS.arrow, 14)])
          : r.minutes ? el("span.exam-prep__day-min", {}, t("exam.planMin", { n: r.minutes })) : null,
      ].filter(Boolean));
    })),
  ]) : null;
  const weakPanel = el("section.panel", {}, [
    el("h3", {}, t("exam.weakHeading")),
    weak.length
      ? el("div", {}, [
          el("p", {}, plural(weak.length, "exam.weakCountOne", "exam.weakCountMany")),
          weakTopics.length ? el("p.note", {}, weakTopics.join(" · ")) : null,
        ].filter(Boolean))
      : el("p.note", {}, t("exam.weakNone")),
  ]);

  /* ---- your sets ---- */
  const setsPanel = el("section.panel", {}, [
    el("h3", {}, t("exam.setsHeading", { subject: subject.name })),
    el("div.exam-prep__sets", {}, sets.map((a) => {
      const sm = masteryForAssignment(a, tm);
      return el("div.exam-prep__set", {}, [
        el("a.exam-prep__set-link", { href: `#/session/${a.id}` }, [
          el("span.exam-prep__set-title", {}, a.title),
          el("span.exam-prep__set-pct", {}, sm == null ? "—" : `${Math.round(sm * 100)}%`),
          icon(ICONS.play, 14),
        ]),
        el("a.iconbtn.iconbtn--sm", {
          href: `#/print/${a.id}`, "aria-label": t("print.worksheet"), title: t("print.worksheet"),
        }, [icon(ICONS.fileText, 15)]),
      ]);
    })),
  ]);

  /* ---- due for review ---- */
  const duePanel = dueN
    ? el("section.panel", {}, [
        el("p", { style: { marginBottom: "8px" } }, plural(dueN, "exam.dueSrsOne", "exam.dueSrsMany")),
        el("a.linkbtn", { href: "#/review" }, [icon(ICONS.spark, 13), " ", t("prog.reviewToday")]),
      ])
    : null;

  /* ---- actions ---- */
  const totalQ = sets.reduce((n, a) => n + a.questions.length, 0);
  let mockLen = 40;
  const lenSel = el("select", {
    "aria-label": t("exam.mockLenLabel"),
    onchange: (e) => { mockLen = Number(e.target.value) || 40; },
  }, MOCK_LENGTHS.map((n) => el("option", { value: String(n) }, `${n} min`)));
  lenSel.value = "40";

  const actions = el("section.panel.exam-prep__actions", {}, [
    weak.length
      ? el("a.btn", { href: `#/practice-weak?subject=${subjectId}` },
          [icon(ICONS.target, 16), t("exam.drillBtn")])
      : null,
    totalQ >= MOCK_MIN_QUESTIONS
      ? el("div.exam-prep__mock", {}, [
          el("label.field", { style: { maxWidth: "150px", margin: "0" } },
            [el("span", {}, t("exam.mockLenLabel")), lenSel]),
          el("button.btn", {
            type: "button",
            onclick: () => {
              location.hash = `#/national/mix/${subjectId}?exam=1&min=${mockLen}&count=${MOCK_COUNT}`;
            },
          }, [icon(ICONS.clock, 16), t("exam.mockBtn")]),
        ])
      : el("p.note", {}, t("exam.mockTooFew")),
  ].filter(Boolean));

  return {
    title: heading,
    node: el("div.exam-prep", {}, [
      homeButton(),
      el("h1", {}, heading),
      head,
      planPanel,
      masteryPanel,
      weakPanel,
      setsPanel,
      duePanel,
      actions,
    ].filter(Boolean)),
  };
}

/** `#/exam-prep` — pick a subject. Subjects with a test coming up sort
 *  first (soonest), then weakest mastery, then name. */
function renderLanding() {
  const tm = masteryByTopic(store.attempts);
  const withSets = store.subjects.filter((s) => store.assignments.some((a) => a.subjectId === s.id));

  if (!withSets.length) {
    return {
      title: t("exam.pageTitle"),
      node: el("div.exam-prep", {}, [
        homeButton(),
        el("h1", {}, t("exam.pageTitle")),
        el("section.panel", {}, [
          el("p", {}, t("exam.landingEmpty")),
          el("a.btn", { href: "#/library", style: { marginTop: "12px" } },
            [icon(ICONS.book, 16), t("exam.addFromLibrary")]),
        ]),
      ]),
    };
  }

  const rows = withSets.map((s) => {
    const test = store.upcomingDue().find((a) => a.subjectId === s.id && a.type === "test");
    const m = masteryForSubject(s.id, store.assignments, tm);
    return { s, test, m, days: test ? daysUntil(test.dueAt) : Infinity, mSort: m == null ? 1.01 : m };
  }).sort((a, b) => a.days - b.days || a.mSort - b.mSort || a.s.name.localeCompare(b.s.name));

  return {
    title: t("exam.pageTitle"),
    node: el("div.exam-prep", {}, [
      homeButton(),
      el("h1", {}, t("exam.pageTitle")),
      el("p.note", { style: { marginTop: "-4px" } }, t("exam.landingSub")),
      el("div.exam-prep__pick", {}, rows.map(({ s, test, m }) => {
        const color = store.subjectColor(s.id);
        return el("a.exam-prep__pick-card", {
          href: `#/exam-prep/${s.id}`,
          style: { "--subject": color.solid },
        }, [
          el("span.exam-prep__pick-name", {}, s.name),
          test ? el("span.exam-prep__pick-when", {}, countdownLabel(test.dueAt)) : null,
          el("span.exam-prep__pick-pct", {}, m == null ? "" : `${Math.round(m * 100)}%`),
          icon(ICONS.arrow, 16),
        ].filter(Boolean));
      })),
    ]),
  };
}

function emptyScreen(msg) {
  return {
    title: t("exam.pageTitle"),
    node: el("div.empty", {}, [
      el("h2", {}, t("exam.pageTitle")),
      el("p", {}, msg),
      el("a.btn.btn--ghost", { href: "#/", style: { marginTop: "16px" } }, t("common.backToMenu")),
    ]),
  };
}

// Exam prep. `#/exam-prep` lists your coming tests, then your other subjects;
// `#/exam-prep/:id` is one subject's test — the countdown and today's session
// up top, then the plan to test day, how ready you are, and a mock exam.
//
// A test is the subject's sets marked "test" with a shared date (lib/exam.js),
// set from the "Lägg till prov" dialog (components/exam-dialog.js). Nothing
// else is stored: every visit recomputes from dueAt / attempts / the srs map,
// so doing today's session moves tomorrow's plan on its own.

import { store, nationalMixId } from "../store.js";
import { el, icon, ICONS } from "../lib/dom.js";
import { t, plural, getLang, sentenceCase, fmtDate } from "../lib/i18n.js";
import { localDayKey } from "../lib/activity.js";
import { homeButton } from "../components/nav.js";
import { openExamDialog } from "../components/exam-dialog.js";
import { isHpSetId } from "../lib/hp.js";
import { masteryByTopic, weakSpotQuestions, setProgress } from "../lib/mastery.js";
import {
  nextExam, upcomingExams, readiness, topicsOf, buildExamPlan, practisedSince, MOCK_MIN_QUESTIONS,
} from "../lib/exam.js";

const MOCK_LENGTHS = [20, 40, 60];
const MOCK_COUNT = 20;
// The weak-spots drill runs at most this many (weakSpotQuestions' default).
const DRILL_MAX = 20;
// A long plan shows its first days and its fixed last three; the middle folds.
const PLAN_HEAD = 5;
const PLAN_TAIL = 3;

// Kept across the soft re-renders a store change triggers.
let mockLen = 40;

/* ------------------------------------------------------------------ */
/* the model: everything both screens need about one subject's test    */
/* ------------------------------------------------------------------ */

function prepFor(subjectId, tm) {
  const today = localDayKey();
  const all = store.assignments.filter((a) => a.subjectId === subjectId && !isHpSetId(a.id));
  const exam = nextExam(all, subjectId, today);
  // With a test, everything is about the sets it covers; without, the subject.
  const scope = exam ? exam.sets : all;
  const ids = scope.map((a) => a.id);
  const progress = new Map(scope.map((a) => [a.id, setProgress(a, store.attempts, tm)]));
  const setReady = new Map(scope.map((a) => [a.id, readiness([a], tm).pct]));
  const untouched = scope.filter((a) => progress.get(a.id).seen === 0);
  const softest = scope.filter((a) => progress.get(a.id).seen > 0)
    .sort((x, y) => (setReady.get(x.id) ?? 0) - (setReady.get(y.id) ?? 0))
    .slice(0, 3);
  const weak = weakSpotQuestions(scope, store.attempts, { limit: Infinity });
  const weakTopics = [...new Set(weak.map((w) => w.question.topic))];
  const idSet = new Set(ids);
  const dueCount = store.dueQuestions().filter((d) => idSet.has(d.assignment.id)).length;
  const totalQ = scope.reduce((n, a) => n + (a.questions?.length || 0), 0);
  const canMock = totalQ >= MOCK_MIN_QUESTIONS;
  const plan = exam
    ? buildExamPlan({ days: exam.days, today, untouched, weakTopics: weakTopics.slice(0, 4), dueCount, softest, canMock })
    : null;
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  return {
    subjectId, all, exam, scope, ids, progress, setReady, weak, weakTopics, dueCount, canMock, plan,
    ready: readiness(scope, tm),
    doneToday: practisedSince(store.attempts, scope, startOfDay.getTime()),
  };
}

/* ------------------------------------------------------------------ */
/* links and labels                                                     */
/* ------------------------------------------------------------------ */

const practiceHash = (a) => `#/session/${a.id}?practice=1`;
const weakHash = (m, topic = null) => (m.exam
  ? `#/practice-weak?sets=${m.ids.join(",")}${topic ? `&topic=${encodeURIComponent(topic)}` : ""}`
  : `#/practice-weak?subject=${m.subjectId}`);
const mockHash = (m, min) =>
  `#/national/mix/${m.subjectId}?exam=1&min=${min}&count=${MOCK_COUNT}${m.exam ? `&sets=${m.ids.join(",")}` : ""}`;

function taskHash(r, m) {
  switch (r.kind) {
    case "start": case "practice": return practiceHash(r.set);
    case "drill": return weakHash(m, r.topic);
    case "review": return "#/review";
    case "mock": return mockHash(m, 40);
    case "tonight": return `#/tonight/${m.scope[0].id}`;
    default: return null;
  }
}

function taskLabel(r, subjectName) {
  switch (r.kind) {
    case "start": return t("exam.planFirst", { title: r.set.title });
    case "drill": return t("exam.planDrill", { topic: sentenceCase(r.topic) });
    case "review": return plural(r.n, "exam.planReviewOne", "exam.planReviewMany");
    case "practice": return t("exam.planPractice", { title: r.set.title });
    case "mock": return t("exam.planMock");
    case "tonight": return t("exam.planTonight");
    default: return t("exam.planTestDay", { subject: subjectName });
  }
}

function countdownTitle(days) {
  if (days === 0) return t("exam.isToday");
  if (days === 1) return t("exam.isTomorrow");
  return t("exam.inDays", { n: days });
}

function shortCountdown(days) {
  if (days === 0) return t("date.today");
  if (days === 1) return t("date.tomorrow");
  return t("date.inDays", { n: days });
}

function longDate(dayKey) {
  try {
    return new Date(dayKey + "T00:00:00").toLocaleDateString(
      getLang() === "sv" ? "sv-SE" : "en-GB", { weekday: "long", day: "numeric", month: "long" });
  } catch { return dayKey; }
}

function planDayWhen(offset, dayKey) {
  if (offset === 0) return t("exam.planToday");
  if (offset === 1) return t("exam.planTomorrow");
  return fmtDate(dayKey).replace(/\s\S+$/, ""); // "fre 9 okt" → "fre 9"
}

/* ------------------------------------------------------------------ */
/* small pieces                                                         */
/* ------------------------------------------------------------------ */

/** The readiness ring: how much of the test you've got, in the subject colour. */
function ring(pct, color) {
  const r = 34, c = 2 * Math.PI * r;
  const v = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  const svg = `<svg viewBox="0 0 80 80" aria-hidden="true" focusable="false">`
    + `<circle cx="40" cy="40" r="${r}" class="exam-ring__track"/>`
    + (v > 0 ? `<circle cx="40" cy="40" r="${r}" class="exam-ring__fill" stroke-dasharray="${(c * v / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 40 40)"/>` : "")
    + `</svg>`;
  const node = el("div.exam-ring", {
    role: "img",
    "aria-label": pct == null ? t("exam.readyUnknown") : t("exam.readyAria", { pct }),
    style: { "--subject": color },
    html: svg,
  });
  node.appendChild(el("div.exam-ring__val", { "aria-hidden": "true" }, [
    el("b", {}, pct == null ? "—" : `${pct}%`),
    el("span", {}, t("exam.ready")),
  ]));
  return node;
}

/** A thin bar for one set's or topic's readiness. */
function bar(pct, color) {
  return el("div.exam-bar", { "aria-hidden": "true", style: { "--subject": color } }, [
    el("i", { style: { width: `${Math.max(0, Math.min(100, pct || 0))}%` } }),
  ]);
}

/** Today's session: the one thing to do now, or a tick when it's done. */
function todayBlock(m, subjectName) {
  const { exam, plan } = m;
  if (exam.days === 0) {
    return el("div.exam-today", {}, [
      el("div.exam-today__text", {}, [
        el("span.exam-today__label", {}, t("exam.todayLabel")),
        el("span.exam-today__task", {}, t("exam.testDayBody")),
      ]),
      el("a.btn", { href: `#/tonight-practice/${m.scope[0].id}` }, [t("exam.lastLook"), icon(ICONS.arrow, 16)]),
    ]);
  }
  if (!plan) {
    // Too far out for a daily plan — still point at something useful.
    const first = m.scope.find((a) => m.progress.get(a.id).seen === 0) || m.scope[0];
    return el("div.exam-today", {}, [
      el("div.exam-today__text", {}, [
        el("span.exam-today__label", {}, t("exam.todayLabel")),
        el("span.exam-today__task", {}, t("exam.farOut")),
      ]),
      el("a.btn.btn--ghost", { href: practiceHash(first) }, [t("exam.practiseNow"), icon(ICONS.arrow, 16)]),
    ]);
  }
  const r = plan[0];
  if (m.doneToday) {
    // An ordinary practice day — never the mock, the evening plan or the test itself.
    const next = plan.slice(1).find((x) => ["start", "drill", "review", "practice"].includes(x.kind)) || null;
    return el("div.exam-today.is-done", {}, [
      el("span.exam-today__check", { "aria-hidden": "true" }, [icon(ICONS.check, 18)]),
      el("div.exam-today__text", {}, [
        el("span.exam-today__label", {}, t("exam.doneLabel")),
        el("span.exam-today__task", {}, t("exam.doneBody")),
      ]),
      next ? el("a.btn.btn--ghost", { href: taskHash(next, m) }, [t("exam.oneMore"), icon(ICONS.arrow, 16)]) : null,
    ].filter(Boolean));
  }
  return el("div.exam-today", {}, [
    el("div.exam-today__text", {}, [
      el("span.exam-today__label", {}, [t("exam.todayLabel"), r.minutes ? ` · ${t("exam.planMin", { n: r.minutes })}` : ""]),
      el("span.exam-today__task", {}, taskLabel(r, subjectName)),
    ]),
    el("a.btn", { href: taskHash(r, m) }, [t("exam.startToday"), icon(ICONS.arrow, 16)]),
  ]);
}

/* ------------------------------------------------------------------ */
/* #/exam-prep/:id                                                      */
/* ------------------------------------------------------------------ */

export function renderExamPrep(subjectId) {
  if (!subjectId) return renderLanding();

  const subject = store.subjects.find((s) => s.id === subjectId);
  if (!subject) return emptyScreen(t("exam.noSubject"));
  const title = t("exam.prepFor", { subject: subject.name });

  const tm = masteryByTopic(store.attempts);
  const m = prepFor(subjectId, tm);
  if (!m.all.length) {
    return {
      title,
      node: el("div.exam-prep", {}, [
        homeButton(),
        el("h1", {}, title),
        el("section.panel", {}, [
          el("p", {}, t("exam.noSets", { subject: subject.name })),
          el("a.btn", { href: "#/library", style: { marginTop: "12px" } },
            [icon(ICONS.book, 16), t("exam.addFromLibrary")]),
        ]),
      ]),
    };
  }

  const color = store.subjectColor(subjectId).solid;
  const edit = () => openExamDialog(subjectId);
  const eyebrow = el("p.exam-hero__eyebrow", {}, [el("span.exam-dot"), title]);

  /* ---- hero: countdown + today's session, readiness beside it ---- */
  const hero = el("section.exam-hero", { style: { "--subject": color } }, [
    el("div.exam-hero__main", {}, m.exam ? [
      eyebrow,
      el("h1.exam-hero__title", {}, countdownTitle(m.exam.days)),
      el("p.exam-hero__meta", {}, [
        el("span", {}, sentenceCase(longDate(m.exam.date))),
        el("span", { "aria-hidden": "true" }, "·"),
        el("span", {}, plural(m.scope.length, "exam.coversOne", "exam.coversMany")),
        el("button.linkbtn", { type: "button", onclick: edit }, [icon(ICONS.pencil, 13), t("exam.edit")]),
      ]),
      todayBlock(m, subject.name),
    ] : [
      eyebrow,
      el("h1.exam-hero__title", {}, t("exam.whenTitle")),
      el("p.exam-hero__lede", {}, t("exam.whenBody")),
      el("div.exam-hero__cta", {}, [
        el("button.btn", { type: "button", onclick: edit }, [icon(ICONS.plus, 16), t("exam.addTest")]),
      ]),
    ]),
    el("div.exam-hero__side", {}, [
      ring(m.ready.seen ? m.ready.pct : null, color),
      m.ready.topics
        ? el("p.exam-hero__cover", {}, t("exam.coverage", { seen: m.ready.seen, n: m.ready.topics }))
        : null,
    ].filter(Boolean)),
  ]);

  /* ---- the plan ---- */
  let planPanel = null;
  if (m.plan) {
    const rows = m.plan;
    const fold = rows.length > PLAN_HEAD + PLAN_TAIL + 1;
    const hidden = fold ? rows.length - PLAN_HEAD - PLAN_TAIL : 0;
    const list = el("ol.exam-plan");
    rows.forEach((r, i) => {
      const today = r.dayOffset === 0;
      const done = today && m.doneToday;
      const folded = fold && i >= PLAN_HEAD && i < rows.length - PLAN_TAIL;
      if (fold && i === PLAN_HEAD) {
        const more = el("li.exam-plan__more", {}, [
          el("button.linkbtn", {
            type: "button",
            onclick: () => {
              list.querySelectorAll(".exam-plan__day.is-folded").forEach((n) => n.classList.remove("is-folded"));
              more.remove();
            },
          }, plural(hidden, "exam.planMoreOne", "exam.planMoreMany")),
        ]);
        list.appendChild(more);
      }
      const hash = today && !done ? taskHash(r, m) : null;
      list.appendChild(el("li.exam-plan__day"
        + (today ? ".is-today" : "") + (done ? ".is-done" : "")
        + (r.kind === "testday" ? ".is-test" : "") + (folded ? ".is-folded" : ""), {}, [
        el("span.exam-plan__when", {}, planDayWhen(r.dayOffset, r.dayKey)),
        el("span.exam-plan__task", {}, done ? t("exam.doneLabel") : taskLabel(r, subject.name)),
        done ? el("span.exam-plan__tick", {}, [icon(ICONS.check, 15)])
          : hash ? el("a.btn.btn--sm", { href: hash }, [t("exam.planStart"), icon(ICONS.arrow, 14)])
            : r.minutes ? el("span.exam-plan__min", {}, t("exam.planMin", { n: r.minutes })) : null,
      ].filter(Boolean)));
    });
    planPanel = el("section.panel.exam-panel", {}, [
      el("h2.exam-panel__head", {}, t("exam.planTitle")),
      el("p.note", {}, t("exam.planSub")),
      list,
    ]);
  }

  /* ---- mock exam ---- */
  const mixId = nationalMixId(subjectId);
  const lastMock = store.attempts
    .filter((a) => a.examMode && a.assignmentId === mixId)
    .sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0))[0];
  const startMock = el("a.btn", { href: mockHash(m, mockLen) }, [icon(ICONS.clock, 16), t("exam.mockBtn")]);
  const lenGroup = el("div.exam-seg", { role: "radiogroup", "aria-label": t("exam.mockLenLabel") },
    MOCK_LENGTHS.map((n) => el("button.exam-seg__opt", {
      type: "button", role: "radio", "aria-checked": String(n === mockLen),
      onclick: (e) => {
        mockLen = n;
        lenGroup.querySelectorAll(".exam-seg__opt").forEach((b) => b.setAttribute("aria-checked", String(b === e.currentTarget)));
        startMock.href = mockHash(m, mockLen);
      },
    }, t("exam.planMin", { n }))));
  const mockPanel = el("section.panel.exam-panel", {}, [
    el("h2.exam-panel__head", {}, t("exam.mockTitle")),
    m.canMock ? el("p.note", {}, t(m.exam ? "exam.mockBodyTest" : "exam.mockBody", { n: MOCK_COUNT })) : null,
    m.canMock && lastMock ? el("p.exam-mock__last", {}, t("exam.mockLast", {
      pct: lastMock.scorePct ?? 0, when: fmtDate(localDayKey(new Date(lastMock.finishedAt || Date.now()))),
    })) : null,
    m.canMock
      ? el("div.exam-mock__row", {}, [lenGroup, startMock])
      : el("p.note", {}, t("exam.mockTooFew")),
  ].filter(Boolean));

  /* ---- where you stand ---- */
  const setRows = [...m.scope]
    .sort((x, y) => (m.setReady.get(x.id) ?? 0) - (m.setReady.get(y.id) ?? 0))
    .map((a) => {
      const p = m.progress.get(a.id);
      const pct = p.seen ? m.setReady.get(a.id) : null;
      return el("div.exam-set", {}, [
        el("div.exam-set__main", {}, [
          el("span.exam-set__title", {}, a.title),
          el("span.exam-set__meta", {}, p.seen ? t("exam.setSeen", { seen: p.seen, n: p.total }) : t("exam.setNew")),
          bar(pct, color),
        ]),
        el("span.exam-set__pct.tabular", {}, pct == null ? "—" : `${pct}%`),
        el("a.btn.btn--ghost.btn--sm", {
          href: practiceHash(a), "aria-label": t("exam.practiseAria", { title: a.title }),
        }, t("exam.practise")),
        el("a.iconbtn.iconbtn--sm", {
          href: `#/print/${a.id}`, "aria-label": t("print.worksheet"), title: t("print.worksheet"),
        }, [icon(ICONS.fileText, 15)]),
      ]);
    });

  const others = m.exam ? m.all.length - m.scope.length : 0;
  const topicList = topicsOf(m.scope)
    .map((topic) => ({ topic, mv: tm[topic] }))
    .sort((a, b) => (a.mv ?? -1) - (b.mv ?? -1));

  const standPanel = el("section.panel.exam-panel", {}, [
    el("h2.exam-panel__head", {}, t("exam.standTitle")),
    el("div.exam-sets", {}, setRows),
    others ? el("p.exam-others", {}, [
      plural(others, "exam.othersOne", "exam.othersMany"), " ",
      el("button.linkbtn", { type: "button", onclick: edit }, t("exam.edit")),
    ]) : null,

    el("h3.exam-sub", {}, t("exam.weakHeading")),
    m.weak.length
      ? el("div.exam-weak", {}, [
          el("div.exam-weak__chips", {}, m.weakTopics.slice(0, 5).map((tp) =>
            el("a.exam-chip", { href: weakHash(m, tp) }, sentenceCase(tp)))),
          el("a.btn.btn--sm", { href: weakHash(m) }, [icon(ICONS.target, 15),
            plural(Math.min(m.weak.length, DRILL_MAX), "exam.drillOne", "exam.drillMany")]),
        ])
      : el("p.note", {}, m.ready.seen ? t("exam.weakNone") : t("exam.weakUnknown")),

    m.dueCount ? el("p.exam-due", {}, [
      icon(ICONS.spark, 14),
      el("span", {}, plural(m.dueCount, "exam.dueSrsOne", "exam.dueSrsMany")),
      el("a.linkbtn", { href: "#/review" }, t("prog.reviewToday")),
    ]) : null,

    topicList.length ? el("details.exam-topics", {}, [
      el("summary", {}, t("exam.allTopics", { n: topicList.length })),
      el("div.exam-topics__list", {}, topicList.map(({ topic, mv }) => {
        const tp = mv == null ? null : Math.round(mv * 100);
        return el("div.exam-topic", {}, [
          el("span.exam-topic__name", {}, sentenceCase(topic)),
          bar(tp, color),
          el("span.exam-topic__pct.tabular", {}, tp == null ? "—" : `${tp}%`),
        ]);
      })),
    ]) : null,
  ].filter(Boolean));

  return {
    title,
    node: el("div.exam-prep", {}, [
      homeButton(),
      hero,
      el("div.exam-prep__cols", {}, [
        el("div.exam-prep__col", {}, [planPanel, mockPanel].filter(Boolean)),
        el("div.exam-prep__col", {}, [standPanel]),
      ]),
    ]),
  };
}

/* ------------------------------------------------------------------ */
/* #/exam-prep                                                          */
/* ------------------------------------------------------------------ */

function renderLanding() {
  const tm = masteryByTopic(store.attempts);
  const today = localDayKey();
  // Högskoleprovet has its own hub (#/hp) with its own scoring — keep its
  // sets out of the school-test lists.
  const hasHp = store.assignments.some((a) => isHpSetId(a.id));
  const plain = store.assignments.filter((a) => !isHpSetId(a.id));
  const withSets = store.subjects.filter((s) => plain.some((a) => a.subjectId === s.id));

  if (!withSets.length && !hasHp) {
    return {
      title: t("exam.pageTitle"),
      node: el("div.exam-prep", {}, [
        homeButton(),
        el("h1", {}, t("exam.pageTitle")),
        el("p.exam-lede", {}, t("exam.landingSub")),
        howItWorks(),
        el("section.panel", {}, [
          el("p", {}, t("exam.landingEmpty")),
          el("a.btn", { href: "#/library", style: { marginTop: "12px" } },
            [icon(ICONS.book, 16), t("exam.addFromLibrary")]),
        ]),
      ]),
    };
  }

  const exams = upcomingExams(plain, today).filter((x) => withSets.some((s) => s.id === x.subjectId));
  const withExam = new Set(exams.map((x) => x.subjectId));

  const cards = exams.map((x) => {
    const s = store.subjects.find((y) => y.id === x.subjectId);
    const m = prepFor(s.id, tm);
    const color = store.subjectColor(s.id).solid;
    const r = m.plan?.[0];
    const pct = m.ready.seen ? m.ready.pct : null;
    return el("article.exam-card", { style: { "--subject": color } }, [
      el("div.exam-card__top", {}, [
        el("a.exam-card__name", { href: `#/exam-prep/${s.id}` }, [el("span.exam-dot"), s.name]),
        el("span.exam-pill" + (x.days <= 2 ? ".is-soon" : ""), {}, shortCountdown(x.days)),
      ]),
      el("p.exam-card__meta", {}, [
        sentenceCase(fmtDate(x.date)), " · ", plural(m.scope.length, "exam.coversOne", "exam.coversMany"),
      ]),
      el("div.exam-card__ready", {}, [
        bar(pct, color),
        el("span.tabular", {}, pct == null ? t("exam.notStarted") : t("exam.readyShort", { pct })),
      ]),
      el("div.exam-card__today", {}, m.doneToday
        ? [el("span.exam-card__done", {}, [icon(ICONS.check, 15), t("exam.doneLabel")])]
        : r && r.kind !== "testday"
          ? [
              el("span.exam-card__task", {}, [el("b", {}, `${t("exam.planToday")}: `), taskLabel(r, s.name)]),
              el("a.btn.btn--sm", { href: taskHash(r, m) }, [t("exam.planStart"), icon(ICONS.arrow, 14)]),
            ]
          : [el("span.exam-card__task", {}, x.days === 0 ? t("exam.testDayBody") : t("exam.farOut"))]),
    ]);
  });

  const rest = withSets.filter((s) => !withExam.has(s.id)).map((s) => {
    const color = store.subjectColor(s.id).solid;
    const ready = readiness(plain.filter((a) => a.subjectId === s.id), tm);
    return el("div.exam-row", { style: { "--subject": color } }, [
      el("a.exam-row__name", { href: `#/exam-prep/${s.id}` }, [el("span.exam-dot"), s.name]),
      el("span.exam-row__ready.tabular", {},
        ready.pct == null || !ready.seen ? t("exam.notStarted") : t("exam.readyShort", { pct: ready.pct })),
      el("button.btn.btn--ghost.btn--sm", {
        type: "button",
        onclick: () => openExamDialog(s.id, { onSaved: () => { location.hash = `#/exam-prep/${s.id}`; } }),
        "aria-label": t("exam.addTestFor", { subject: s.name }),
      }, [icon(ICONS.plus, 14), t("exam.addTest")]),
    ]);
  });

  const hpRow = hasHp ? el("div.exam-row", { style: { "--subject": "var(--brand)" } }, [
    el("a.exam-row__name", { href: "#/hp" }, [el("span.exam-dot"), t("hp.pageTitle")]),
    el("span.exam-row__ready", {}, t("hp.pickHint")),
    icon(ICONS.arrow, 16),
  ]) : null;

  return {
    title: t("exam.pageTitle"),
    node: el("div.exam-prep", {}, [
      homeButton(),
      el("h1", {}, t("exam.pageTitle")),
      el("p.exam-lede", {}, t("exam.landingSub")),
      cards.length ? el("section.exam-section", {}, [
        el("h2.exam-section__head", {}, t("exam.upcoming")),
        el("div.exam-cards", {}, cards),
      ]) : howItWorks(),
      rest.length || hpRow ? el("section.exam-section", {}, [
        el("h2.exam-section__head", {}, t(cards.length ? "exam.otherSubjects" : "exam.yourSubjects")),
        el("div.exam-rows", {}, [...rest, hpRow].filter(Boolean)),
      ]) : null,
    ].filter(Boolean)),
  };
}

/** How it works, in the order you do it — shown until the first test is added. */
function howItWorks() {
  const step = (n, ic) => el("li.exam-how__step", {}, [
    el("span.exam-how__n", { "aria-hidden": "true" }, String(n)),
    el("div.exam-how__text", {}, [
      el("b", {}, [icon(ic, 15), t(`exam.how${n}Title`)]),
      el("span", {}, t(`exam.how${n}Body`)),
    ]),
  ]);
  return el("ol.exam-how", { "aria-label": t("exam.howLabel") }, [
    step(1, ICONS.calendar),
    step(2, ICONS.target),
    step(3, ICONS.clock),
  ]);
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

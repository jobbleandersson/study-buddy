// The study flow around one test: what is on it and how ready you are, the day-by-day plan, which of
// today's tasks are done, and where each task leads. Shared by the exam-prep page, a session started
// from it and the results screen, so "Nästa" after a pass and the page always agree on what's next.
//
// Every link out of here carries `prov=<test id>`, so the session knows it belongs to the test (its
// header says so, and the attempt remembers it for the results screen).

import { store, nationalMixId, WEAK_ID } from "../store.js";
import { t, plural, sentenceCase } from "../lib/i18n.js";
import { localDayKey } from "../lib/activity.js";
import { masteryByTopic, weakSpotQuestions, setProgress } from "../lib/mastery.js";
import {
  upcomingExams, readiness, buildExamPlan, scopeAttempts, planStartSets, mockCountFor, MOCK_MIN_QUESTIONS,
} from "../lib/exam.js";

/** The mock length a plan task starts. */
export const PLAN_MOCK_MIN = 40;

/** A coming test by its id, or — for the older `#/exam-prep/<subjectId>` links — that subject's next one. */
export function resolveExam(param) {
  const list = upcomingExams(store.exams, store.assignments, localDayKey());
  return list.find((e) => e.id === param) || list.find((e) => e.subjectId === param) || null;
}

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** Kinds of task that are study work today — the evening-before checklist and test day are not. */
export const isStudyTask = (task) => ["start", "practice", "drill", "review", "mock"].includes(task?.kind);

/** A set counts as done today when it was run as a set today, or most of it was answered today some other
 *  way (a mixed pass, say) — not because one of its questions turned up once. */
function setDoneToday(set, todays) {
  if (todays.some((a) => a.assignmentId === set.id)) return true;
  const ids = new Set((set.questions || []).map((q) => q.id));
  const answered = new Set();
  for (const a of todays) for (const it of a.items || []) if (ids.has(it.questionId)) answered.add(it.questionId);
  return ids.size > 0 && answered.size >= Math.ceil(ids.size * 0.6);
}

/** Everything the screens need about one test. `exam` is an entry from upcomingExams() (record + days +
 *  sets). Only the test's own sets, and only answers to their questions, go into any of this. */
export function prepFor(exam) {
  const today = localDayKey();
  const since = startOfToday();
  const scope = exam.sets;
  const ids = scope.map((a) => a.id);
  const attempts = scopeAttempts(store.attempts, scope);
  const todays = attempts.filter((a) => (a.finishedAt || 0) >= since);
  const seenBefore = new Set();
  for (const a of attempts) if ((a.finishedAt || 0) < since) for (const it of a.items || []) seenBefore.add(it.questionId);

  const tm = masteryByTopic(attempts);
  const progress = new Map(scope.map((a) => [a.id, setProgress(a, attempts, tm)]));
  const setReady = new Map(scope.map((a) => [a.id, readiness([a], tm).pct]));
  // New to the plan = not opened before today. The ones finished today stay on today's row as done.
  const newSets = scope.filter((a) => !(a.questions || []).some((q) => seenBefore.has(q.id)));
  const doneToday = newSets.filter((a) => setDoneToday(a, todays));
  const untouched = newSets.filter((a) => !doneToday.includes(a));
  const softest = scope.filter((a) => progress.get(a.id).seen > 0 && !newSets.includes(a))
    .sort((x, y) => (setReady.get(x.id) ?? 0) - (setReady.get(y.id) ?? 0))
    .slice(0, 3);
  const weak = weakSpotQuestions(scope, attempts, { limit: Infinity });
  const weakTopics = [...new Set(weak.map((w) => w.question.topic))];
  const idSet = new Set(ids);
  const dueCount = store.dueQuestions().filter((d) => idSet.has(d.assignment.id)).length;
  const totalQ = scope.reduce((n, a) => n + (a.questions?.length || 0), 0);
  const canMock = totalQ >= MOCK_MIN_QUESTIONS;
  const plan = buildExamPlan({
    days: exam.days, today, untouched, doneToday, weakTopics: weakTopics.slice(0, 4), dueCount, softest, canMock,
  });

  const m = {
    exam, subjectId: exam.subjectId, scope, ids, tm, attempts, todays, progress, setReady, weak, weakTopics,
    dueCount, canMock, plan,
    ready: readiness(scope, tm),
    // How much of the test the plan reaches: sets already opened before today, plus the ones it schedules.
    coverage: plan ? { planned: (scope.length - newSets.length) + planStartSets(plan).length, total: scope.length } : null,
  };
  // Today's tasks, each with whether it is done. Study work only counts toward "done for today".
  m.today = (plan?.[0]?.tasks || []).filter((task) => task.kind !== "testday").map((task) => ({ task, done: taskDone(task, m) }));
  const study = m.today.filter((x) => isStudyTask(x.task));
  m.todayStudy = study;
  m.allDoneToday = study.length > 0 && study.every((x) => x.done);
  m.anyDoneToday = todays.length > 0;
  return m;
}

function taskDone(task, m) {
  switch (task.kind) {
    case "start": case "practice": return setDoneToday(task.set, m.todays);
    case "drill": return m.todays.some((a) => a.assignmentId === WEAK_ID);
    case "review": return m.todays.some((a) => a.isReview);
    case "mock": return m.todays.some((a) => a.examMode);
    default: return false;
  }
}

const prov = (m) => `prov=${m.exam.id}`;

/** Where a plan task leads. */
export function taskHash(task, m) {
  switch (task.kind) {
    case "start": case "practice": return `#/session/${task.set.id}?practice=1&${prov(m)}`;
    case "drill": return `#/practice-weak?sets=${m.ids.join(",")}${task.topic ? `&topic=${encodeURIComponent(task.topic)}` : ""}&${prov(m)}`;
    case "review": return `#/review?sets=${m.ids.join(",")}&${prov(m)}`;
    case "mock": return mockHash(m, PLAN_MOCK_MIN);
    case "tonight": return `#/tonight/${m.scope[0].id}`;
    default: return null;
  }
}

export const weakHash = (m, topic = null) =>
  `#/practice-weak?sets=${m.ids.join(",")}${topic ? `&topic=${encodeURIComponent(topic)}` : ""}&${prov(m)}`;
export const reviewHash = (m) => `#/review?sets=${m.ids.join(",")}&${prov(m)}`;
export const practiceHash = (a, m) => `#/session/${a.id}?practice=1${m ? `&${prov(m)}` : ""}`;
export const mockHash = (m, min) =>
  `#/national/mix/${m.subjectId}?exam=1&min=${min}&count=${mockCountFor(min)}&sets=${m.ids.join(",")}&${prov(m)}`;
export const passHash = (m, min) => `#/exam-pass/${m.exam.id}?min=${min}`;

export function taskLabel(task, subjectName) {
  switch (task.kind) {
    case "start": return t("exam.planFirst", { title: task.set.title });
    case "drill": return t("exam.planDrill", { topic: sentenceCase(task.topic) });
    case "review": return plural(task.n, "exam.planReviewOne", "exam.planReviewMany");
    case "practice": return t("exam.planPractice", { title: task.set.title });
    case "mock": return t("exam.planMock");
    case "tonight": return t("exam.planTonight");
    default: return t("exam.planTestDay", { subject: subjectName });
  }
}

export function shortCountdown(days) {
  if (days === 0) return t("date.today");
  if (days === 1) return t("date.tomorrow");
  return t("date.inDays", { n: days });
}

/** What to do next for this test: the first of today's study tasks not done yet, or — when today is
 *  done — the next study task from the coming days ("one more"). null when there is nothing left. */
export function nextStep(exam) {
  const m = prepFor(exam);
  const subjectName = store.subjects.find((s) => s.id === exam.subjectId)?.name || "";
  const open = m.todayStudy.find((x) => !x.done);
  if (open) return { label: taskLabel(open.task, subjectName), hash: taskHash(open.task, m), extra: false };
  for (const row of (m.plan || []).slice(1)) {
    const task = (row.tasks || []).find(isStudyTask);
    if (task) return { label: taskLabel(task, subjectName), hash: taskHash(task, m), extra: true };
  }
  return null;
}

/** "Historia 1a1 · om 3 dagar · idag 1 av 2 klara" — the line a session from the test shows. */
export function contextLine(exam) {
  const m = prepFor(exam);
  const subjectName = store.subjects.find((s) => s.id === exam.subjectId)?.name || "";
  const title = exam.title || subjectName;
  const done = m.todayStudy.filter((x) => x.done).length;
  return m.todayStudy.length
    ? t("exam.ctxLine", { title, when: shortCountdown(exam.days), done, total: m.todayStudy.length })
    : t("exam.ctxLineShort", { title, when: shortCountdown(exam.days) });
}

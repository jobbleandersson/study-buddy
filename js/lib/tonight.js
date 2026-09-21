// "Kvällen före provet" — the small, finite plan for the evening before a test.
// Pure helpers: which tests turn the app into evening mode, which questions
// are worth a last look, how long each step takes, and when the quiet hours
// end. No DOM and no store, so it can be tested on its own.

import { addDays, localDayKey } from "./activity.js";

/** Questions in the last-look session. Enough to feel done, few enough to stop. */
export const TONIGHT_QUESTIONS = 8;

/** Tests due tomorrow — the ones that switch the app to evening mode. Only real
 *  tests: an assignment with a due date isn't a "prov". */
export function testsTomorrow(assignments, today = localDayKey()) {
  const tomorrow = addDays(today, 1);
  return (assignments || []).filter((a) => a && a.type === "test" && a.dueAt === tomorrow);
}

/** Storage key for one evening's checklist: the day it's for, and the subject. */
export const tonightKey = (dayKey, subjectId) => `${dayKey}|${subjectId}`;

// The formula sheet covers maths, physics and chemistry — only offer it there.
const FORMULA_SUBJECT = /matem|math|fysik|physics|kemi|chem/i;
export const isFormulaSubject = (name) => FORMULA_SUBJECT.test(String(name || ""));

/**
 * The questions worth a last look, best first:
 *  1. ones you've got right but that haven't settled yet (short review
 *     interval) — the ones a last pass helps most, oldest-due first;
 *  2. a couple you missed and haven't got back;
 *  3. ones you haven't seen, so a fresh subject still gets a session;
 *  4. ones you already know cold, only if there's room.
 * `pick` orders the buckets that have no natural order (the session passes a shuffle).
 */
export function pickTonightQuestions(assignments, srs, { subjectId, limit = TONIGHT_QUESTIONS, pick = (a) => a } = {}) {
  const nearly = [], missed = [], fresh = [], settled = [];
  for (const a of assignments || []) {
    if (a.subjectId !== subjectId) continue;
    for (const q of a.questions || []) {
      const rec = srs?.[q.id];
      if (!rec) fresh.push(q.id);
      else if (rec.reps >= 1 && (rec.intervalDays || 0) < 21) nearly.push({ id: q.id, dueAt: rec.dueAt || 0 });
      else if (rec.reps >= 1) settled.push(q.id);
      else if (rec.lapses > 0) missed.push(q.id);
      else fresh.push(q.id);
    }
  }
  nearly.sort((x, y) => x.dueAt - y.dueAt);
  const ids = [
    ...nearly.map((n) => n.id),
    ...pick(missed).slice(0, 2),
    ...pick(fresh),
    ...pick(settled),
  ];
  return [...new Set(ids)].slice(0, limit);
}

/**
 * The evening's steps, each with a rough minute count, in the order to do them.
 * A step that has nothing to work with is left out — no rules, no "read your rules".
 */
export function buildSteps({ rulesCount = 0, questionCount = 0, formulas = false } = {}) {
  const steps = [];
  if (rulesCount > 0) steps.push({ id: "rules", minutes: Math.max(1, Math.min(4, Math.ceil(rulesCount / 4))), n: rulesCount });
  if (questionCount > 0) steps.push({ id: "practice", minutes: Math.max(2, Math.round(questionCount * 0.6)), n: questionCount });
  if (formulas) steps.push({ id: "formulas", minutes: 3 });
  return steps;
}

/** Minutes done and in total, given which step ids are complete. */
export function progressMinutes(steps, doneIds) {
  const done = new Set(doneIds);
  const total = steps.reduce((sum, s) => sum + s.minutes, 0);
  const finished = steps.filter((s) => done.has(s.id)).reduce((sum, s) => sum + s.minutes, 0);
  return { done: finished, total };
}

/** The next 06:30 (or `hour:minute`) after `now`, as ms — when quiet hours end. */
export function nextMorning(now = Date.now(), { hour = 6, minute = 30 } = {}) {
  const d = new Date(now);
  d.setHours(hour, minute, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

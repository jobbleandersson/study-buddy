// Exam prep (#/exam-prep), the pure part: which sets a subject's next test
// covers, how ready you are for it, and the day-by-day plan up to it.
// No DOM and no store, so it can be tested on its own.
//
// A test is not its own record. It's the sets in one subject that are marked
// "test" and share a due date — the same thing the home countdown, calendar,
// reminders and the evening-before plan already read. Ticking several sets
// in the exam dialog gives them all that date.

import { addDays } from "./activity.js";

/** Minutes each kind of plan day takes — shown next to the task. */
export const PLAN_MINUTES = { start: 20, drill: 25, review: 15, practice: 20, mock: 40, tonight: 15, testday: 0 };

/** Further out than this, a day-by-day list is more noise than help. */
export const PLAN_MAX_DAYS = 60;

/** Fewer questions than this in the test's sets and a mock isn't worth it. */
export const MOCK_MIN_QUESTIONS = 5;

/** Whole days from one "YYYY-MM-DD" key to another; negative when `to` is earlier. */
export function dayDiff(from, to) {
  const utc = (k) => Date.UTC(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)));
  return Math.round((utc(to) - utc(from)) / 864e5);
}

const isTest = (a) => a && a.type === "test" && typeof a.dueAt === "string";

/** A subject's next test: the soonest date from today on that has a test set,
 *  with every test set of the subject sharing that date. null when none. */
export function nextExam(assignments, subjectId, today) {
  const list = (assignments || []).filter((a) => isTest(a) && a.subjectId === subjectId && a.dueAt >= today);
  if (!list.length) return null;
  const date = list.reduce((min, a) => (a.dueAt < min ? a.dueAt : min), list[0].dueAt);
  return { date, days: dayDiff(today, date), sets: list.filter((a) => a.dueAt === date) };
}

/** Every subject's next test, soonest first. */
export function upcomingExams(assignments, today) {
  const ids = [...new Set((assignments || []).filter((a) => isTest(a) && a.dueAt >= today).map((a) => a.subjectId))];
  return ids.map((id) => ({ subjectId: id, ...nextExam(assignments, id, today) }))
    .sort((x, y) => x.date.localeCompare(y.date));
}

/** Every topic a group of sets covers, in the order they first appear. */
export function topicsOf(sets) {
  const out = new Set();
  for (const a of sets || []) for (const q of a.questions || []) if (q.topic) out.add(q.topic);
  return [...out];
}

/**
 * How ready you are for a group of sets: mean mastery over every topic they
 * cover, where a topic you've never practised counts as 0. So 100 % means
 * you've done all of it well, not just the one part you tried.
 * `pct` is null when the sets carry no topics at all.
 */
export function readiness(sets, topicMastery) {
  const topics = topicsOf(sets);
  let sum = 0, seen = 0;
  for (const tp of topics) {
    if (tp in topicMastery) { sum += topicMastery[tp]; seen++; }
  }
  return { pct: topics.length ? Math.round((sum / topics.length) * 100) : null, topics: topics.length, seen };
}

/** Did any attempt finished on or after `sinceMs` answer a question from these sets? */
export function practisedSince(attempts, sets, sinceMs) {
  const ids = new Set();
  for (const a of sets || []) for (const q of a.questions || []) ids.add(q.id);
  return (attempts || []).some((att) => (att.finishedAt || 0) >= sinceMs
    && (att.items || []).some((it) => ids.has(it.questionId)));
}

/**
 * The plan, today → test day, one task a day. Stateless: rebuilt on every
 * visit, so today's session moves tomorrow's plan on its own.
 *
 * First, one day for each set you've never opened (cover it all before going
 * deep). Then it rotates through your weak topics, reviews that are due, the
 * sets you're shakiest on, and the once-new sets again as plain practice.
 * The last days are fixed: a mock exam two days out, the evening-before
 * plan, then the test.
 *
 * @param days        whole days until the test (0 = today)
 * @param today       "YYYY-MM-DD"
 * @param untouched   sets in the test never practised
 * @param weakTopics  weak topic names, weakest first
 * @param dueCount    spaced-repetition questions due in these sets
 * @param softest     practised sets, shakiest first
 * @param canMock     enough questions for a mock exam
 * @returns rows [{ dayOffset, dayKey, kind, minutes, set?, topic?, n? }] or null
 */
export function buildExamPlan({ days, today, untouched = [], weakTopics = [], dueCount = 0, softest = [], canMock = true }) {
  if (!(days >= 1) || days > PLAN_MAX_DAYS) return null;
  const first = untouched.map((set) => ({ kind: "start", set }));
  const rotate = [
    ...weakTopics.map((topic) => ({ kind: "drill", topic })),
    ...(dueCount ? [{ kind: "review", n: dueCount }] : []),
    ...softest.map((set) => ({ kind: "practice", set })),
    ...untouched.map((set) => ({ kind: "practice", set })),
  ];
  if (!rotate.length) return null; // no sets in the test — nothing to plan
  const rows = [];
  let rp = 0;
  for (let d = 0; d <= days; d++) {
    let task;
    if (d === days) task = { kind: "testday" };
    else if (d === days - 1) task = { kind: "tonight" };
    else if (d === days - 2 && canMock) task = { kind: "mock" };
    else if (rp < first.length) { task = first[rp]; rp++; }
    else { task = rotate[(rp - first.length) % rotate.length]; rp++; }
    rows.push({ dayOffset: d, dayKey: addDays(today, d), minutes: PLAN_MINUTES[task.kind], ...task });
  }
  return rows;
}

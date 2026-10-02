// Exam prep (#/exam-prep), the pure part: what a test covers, how ready you
// are for it, and the day-by-day plan up to it.
// No DOM and no store, so it can be tested on its own.
//
// A test is its own record — { id, subjectId, date, title, note, setIds,
// createdAt } — made in the "Lägg till prov" dialog. What it covers is exactly
// the sets (`setIds`) the student picked there, including any set built from
// material added for that test: nothing is inferred from the subject, so a
// subject's other sets never end up in a test. Everything exam prep shows
// (readiness, weak spots, the plan, the mock) is worked out from those sets
// and from the answers given to their questions, and nothing else.
//
// The store mirrors a test's date onto the sets it covers (type "test", dueAt)
// so the home countdown, calendar, reminders and the evening-before plan keep
// working unchanged; the record is the source of truth.

import { addDays } from "./activity.js";

/** Minutes each kind of plan day takes — shown next to the task. */
export const PLAN_MINUTES = { start: 20, drill: 25, review: 15, practice: 20, mock: 40, tonight: 15, testday: 0 };

/** Further out than this, a day-by-day list is more noise than help. */
export const PLAN_MAX_DAYS = 60;

/** Fewer questions than this in the test's sets and a mock isn't worth it. */
export const MOCK_MIN_QUESTIONS = 5;

export const EXAM_TITLE_MAX = 80;
export const EXAM_NOTE_MAX = 400;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Whole days from one "YYYY-MM-DD" key to another; negative when `to` is earlier. */
export function dayDiff(from, to) {
  const utc = (k) => Date.UTC(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)));
  return Math.round((utc(to) - utc(from)) / 864e5);
}

/** A well-formed test record, or null. Used on whatever arrives from storage or a sync. */
export function normalizeExam(x) {
  if (!x || typeof x !== "object" || typeof x.id !== "string" || !x.id) return null;
  if (typeof x.subjectId !== "string" || !DAY_RE.test(x.date || "")) return null;
  return {
    id: x.id,
    subjectId: x.subjectId,
    date: x.date,
    title: typeof x.title === "string" ? x.title.trim().slice(0, EXAM_TITLE_MAX) : "",
    note: typeof x.note === "string" ? x.note.trim().slice(0, EXAM_NOTE_MAX) : "",
    setIds: [...new Set((Array.isArray(x.setIds) ? x.setIds : []).filter((id) => typeof id === "string" && id))],
    createdAt: Number(x.createdAt) || 0,
  };
}

/** Tests not yet past, soonest first, each with `days` until it and `sets`: the sets it
 *  covers that still exist, in the order they were picked. */
export function upcomingExams(exams, assignments, today) {
  const byId = new Map((assignments || []).map((a) => [a.id, a]));
  return (exams || [])
    .filter((e) => e && e.date >= today)
    .map((e) => ({ ...e, days: dayDiff(today, e.date), sets: (e.setIds || []).map((id) => byId.get(id)).filter(Boolean) }))
    .sort((x, y) => x.date.localeCompare(y.date) || (x.createdAt || 0) - (y.createdAt || 0));
}

/** A subject's next test, or null. */
export function nextExam(exams, assignments, subjectId, today) {
  return upcomingExams(exams, assignments, today).find((e) => e.subjectId === subjectId) || null;
}

/** For each set that a coming test covers, the date of the soonest such test. The store puts
 *  these dates on the sets themselves. */
export function examSetDates(exams, today) {
  const out = new Map();
  for (const e of exams || []) {
    if (!e || e.date < today) continue;
    for (const id of e.setIds || []) {
      const d = out.get(id);
      if (!d || e.date < d) out.set(id, e.date);
    }
  }
  return out;
}

/** One-off migration from the old model, where a test was just "the subject's sets marked test
 *  with a shared date": one record per subject + date, covering exactly the sets already marked
 *  — which is what the old exam-prep page showed too. */
export function examsFromMarkedSets(assignments, newId) {
  const groups = new Map();
  for (const a of assignments || []) {
    if (!a || a.type !== "test" || !DAY_RE.test(a.dueAt || "") || !a.subjectId) continue;
    const key = `${a.subjectId}|${a.dueAt}`;
    if (!groups.has(key)) groups.set(key, { subjectId: a.subjectId, date: a.dueAt, setIds: [] });
    groups.get(key).setIds.push(a.id);
  }
  return [...groups.values()].map((g) => ({ id: newId(), title: "", note: "", createdAt: 0, ...g }));
}

/** The attempts, cut down to the answers given to these sets' questions (an attempt with none of
 *  them is dropped). Readiness and weak spots for a test are worked out from this, so practice on
 *  another set of the subject — even on the same topic name — never counts toward it. */
export function scopeAttempts(attempts, sets) {
  const ids = new Set();
  for (const a of sets || []) for (const q of a.questions || []) ids.add(q.id);
  const out = [];
  for (const att of attempts || []) {
    const items = (att.items || []).filter((it) => ids.has(it.questionId));
    if (items.length) out.push({ ...att, items });
  }
  return out;
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
 * The last days are fixed: a mock exam two days out (only once every set has
 * been opened — a mock on material you've never seen teaches nothing), the
 * evening-before plan, then the test.
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
    else if (d === days - 2 && canMock && !untouched.length) task = { kind: "mock" };
    else if (rp < first.length) { task = first[rp]; rp++; }
    else { task = rotate[(rp - first.length) % rotate.length]; rp++; }
    rows.push({ dayOffset: d, dayKey: addDays(today, d), minutes: PLAN_MINUTES[task.kind], ...task });
  }
  return rows;
}

/** Where "prepare for this" leads from a set that has a date: the test that covers it, or — when
 *  none does (the set was just dated or marked a test on its own) — its subject's page with the set
 *  and date in the link, so the dialog opens ready to make a test of it. */
export function prepHashForSet(exams, a) {
  const list = exams || [];
  const e = list.find((x) => x.setIds.includes(a.id) && x.date === a.dueAt) || list.find((x) => x.setIds.includes(a.id));
  if (e) return `#/exam-prep/${e.id}`;
  return `#/exam-prep/${a.subjectId}?date=${a.dueAt}&set=${a.id}`;
}

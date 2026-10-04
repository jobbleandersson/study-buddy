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

import { addDays, isRealDay } from "./activity.js";

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
  if (typeof x.subjectId !== "string" || !isRealDay(x.date)) return null;
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
    if (Object.prototype.hasOwnProperty.call(topicMastery, tp)) { sum += topicMastery[tp]; seen++; }   // not `in`: a topic called "constructor" would match Object's own
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

/** The most sets one day of the plan asks for. Beyond this a day stops being a study session. */
export const MAX_SETS_PER_DAY = 3;

/** How many sets go on each of `days` days: spread evenly, the earliest days taking the extra, never
 *  more than `cap` a day. Returns { counts, uncovered }: what could not fit anywhere. */
export function distributeSets(n, days, cap = MAX_SETS_PER_DAY) {
  const counts = Array.from({ length: Math.max(0, days) }, () => 0);
  if (!counts.length) return { counts, uncovered: n };
  const base = Math.floor(n / counts.length);
  const extra = n % counts.length;
  let placed = 0;
  counts.forEach((_, i) => { counts[i] = Math.min(cap, base + (i < extra ? 1 : 0)); placed += counts[i]; });
  return { counts, uncovered: Math.max(0, n - placed) };
}

/**
 * The plan, today → test day. Stateless: rebuilt on every visit, so today's work moves tomorrow's
 * plan on its own.
 *
 * Every set you have never opened is given a day, spread so that all of them are covered before the
 * test, up to MAX_SETS_PER_DAY a day (fewer days left means more sets a day, not skipped ones). With
 * room to spare, a mock exam sits two days out — only once every set is behind you, since a mock on
 * material you've never seen teaches nothing. Days without a new set rotate through your weak topics,
 * reviews that are due, the sets you're shakiest on, and the once-new sets again as plain practice.
 * The evening before is the last-look plan, then the test.
 *
 * @param days        whole days until the test (0 = today)
 * @param today       "YYYY-MM-DD"
 * @param untouched   sets in the test never opened (not even today)
 * @param doneToday   sets first opened today: they stay on today's row (as done), and the rest of the
 *                    sets are spread around them
 * @param weakTopics  weak topic names, weakest first
 * @param dueCount    spaced-repetition questions due in these sets
 * @param softest     practised sets, shakiest first
 * @param canMock     enough questions for a mock exam
 * @returns one row per day, or null. A row is { dayOffset, dayKey, minutes (the day's total), tasks: [...] }
 *          and also carries its first task's own fields (kind, set?, topic?, n?), so a caller that only
 *          knows one task a day still works. A task is { kind, minutes, set?, topic?, n? }.
 */
export function buildExamPlan({
  days, today, untouched = [], doneToday = [], weakTopics = [], dueCount = 0, softest = [], canMock = true,
  maxSetsPerDay = MAX_SETS_PER_DAY,
}) {
  if (!(days >= 1) || days > PLAN_MAX_DAYS) return null;
  const rotate = [
    ...weakTopics.map((topic) => ({ kind: "drill", topic })),
    ...(dueCount ? [{ kind: "review", n: dueCount }] : []),
    ...softest.map((set) => ({ kind: "practice", set })),
    ...untouched.map((set) => ({ kind: "practice", set })),
    ...doneToday.filter((set) => !softest.includes(set)).map((set) => ({ kind: "practice", set })),
  ];
  if (!rotate.length) return null; // no sets in the test — nothing to plan

  // Room for a mock two days out? Then every new set has to fit on the days before it.
  const mockDay = days - 2;
  const fitsBeforeMock = canMock && mockDay >= 0 && untouched.length + doneToday.length <= mockDay * maxSetsPerDay;
  const setDays = fitsBeforeMock ? mockDay : days;      // new sets go on days 0 .. setDays-1
  // Today's share is worked out with today's finished sets counted in, so finishing sets early lightens
  // the coming days instead of piling more onto today.
  let counts = [];
  if (setDays > 0) {
    const target = distributeSets(untouched.length + doneToday.length, setDays, maxSetsPerDay).counts;
    const today0 = Math.min(untouched.length, Math.max(0, target[0] - doneToday.length));
    counts = [today0, ...distributeSets(untouched.length - today0, setDays - 1, maxSetsPerDay).counts];
  }

  const rows = [];
  let next = 0;        // next unopened set to place
  let rp = 0;          // position in the rotation
  for (let d = 0; d <= days; d++) {
    const tasks = [];
    const sets = d < setDays ? untouched.slice(next, next + counts[d]) : [];
    next += sets.length;
    if (d === 0) for (const set of doneToday) tasks.push({ kind: "start", set });
    for (const set of sets) tasks.push({ kind: "start", set });
    if (d === days) tasks.push({ kind: "testday" });
    else if (d === days - 1) tasks.push({ kind: "tonight" });
    else if (fitsBeforeMock && d === mockDay) tasks.push({ kind: "mock" });
    else if (!tasks.length) { tasks.push(rotate[rp % rotate.length]); rp++; }
    const withMinutes = tasks.map((task) => ({ ...task, minutes: PLAN_MINUTES[task.kind] }));
    rows.push({
      dayOffset: d, dayKey: addDays(today, d),
      ...withMinutes[0],
      minutes: withMinutes.reduce((n, task) => n + task.minutes, 0),   // after the spread: the day's total, not its first task's
      tasks: withMinutes,
    });
  }
  return rows;
}

/** The new sets a plan opens, in order, with the day each lands on. Used to say how much of the test
 *  the plan reaches. */
export function planStartSets(rows) {
  const out = [];
  for (const row of rows || []) for (const task of row.tasks || []) if (task.kind === "start") out.push({ set: task.set, dayOffset: row.dayOffset });
  return out;
}

/* ------------------------------------------------------------------ */
/* a pass sized to your time, and a mock sized to its clock             */
/* ------------------------------------------------------------------ */

/** About how long a question takes: what a pass of N minutes holds. */
export const MINUTES_PER_QUESTION = 1.5;

/** The pass lengths on offer. */
export const STUDY_PASS_MINUTES = [15, 30, 60];

export const questionsForMinutes = (min) => Math.max(5, Math.round(min / MINUTES_PER_QUESTION));

/** Mock exam: how many questions each length asks. Roughly two minutes a question, as in a real test. */
export const MOCK_COUNTS = { 20: 10, 40: 20, 60: 30 };
export const mockCountFor = (min) => MOCK_COUNTS[min] ?? Math.max(5, Math.round(min / 2));

/** Where each question stands: when it was last answered (null = never), whether that answer was
 *  right first time, and whether its review is due. */
function questionStates(sets, attempts, srs, now) {
  const last = new Map();
  for (const att of attempts || []) {
    const at = att.finishedAt || 0;
    for (const it of att.items || []) {
      const prev = last.get(it.questionId);
      if (!prev || at >= prev.at) last.set(it.questionId, { at, ok: it.firstTry ?? !!it.correct });
    }
  }
  const out = [];
  (sets || []).forEach((set, si) => {
    for (const q of set.questions || []) {
      const l = last.get(q.id);
      out.push({ id: q.id, setIndex: si, lastAt: l ? l.at : null, wrong: !!l && !l.ok, due: !!srs?.[q.id] && (srs[q.id].dueAt || 0) <= now });
    }
  });
  return out;
}

/** Take one from each set in turn so every set is represented. The order inside a set is shuffled,
 *  unless `ordered` (the caller has already put the list in the order it wants). */
function mixAcrossSets(list, rng, ordered = false) {
  const bySet = new Map();
  for (const x of list) { if (!bySet.has(x.setIndex)) bySet.set(x.setIndex, []); bySet.get(x.setIndex).push(x); }
  const lanes = [...bySet.values()].map((l) => {
    const a = [...l];
    if (ordered) return a;
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  });
  const out = [];
  for (let round = 0; lanes.some((l) => l.length > round); round++) for (const l of lanes) if (l[round]) out.push(l[round]);
  return out;
}

/**
 * The questions for one sitting of `n` questions across a test's sets, in the order that helps most:
 * what you have never answered, then what you got wrong, then reviews that are due, then whatever you
 * answered longest ago. Each group is mixed across the sets so one set doesn't hog the pass.
 */
export function buildStudyPass({ sets, attempts, srs, n, now = Date.now(), rng = Math.random }) {
  const states = questionStates(sets, attempts, srs, now);
  const taken = new Set();
  const out = [];
  const take = (list, ordered = false) => { for (const x of mixAcrossSets(list, rng, ordered)) { if (out.length < n && !taken.has(x.id)) { taken.add(x.id); out.push(x.id); } } };
  take(states.filter((x) => x.lastAt === null));
  take(states.filter((x) => x.wrong));
  take(states.filter((x) => x.due));
  take([...states].sort((x, y) => (x.lastAt || 0) - (y.lastAt || 0)), true);
  return out;
}

/** The questions for a mock exam of `count`: what you have practised least comes first (never-answered,
 *  then longest ago), mixed across the sets, so a longer mock reaches further into the test. */
export function pickMockQuestions({ sets, attempts, count, now = Date.now(), rng = Math.random }) {
  const states = questionStates(sets, attempts, null, now);
  const never = states.filter((x) => x.lastAt === null);
  const seen = [...states.filter((x) => x.lastAt !== null)].sort((x, y) => x.lastAt - y.lastAt);
  const out = [];
  const taken = new Set();
  for (const [group, ordered] of [[never, false], [seen, true]]) {
    for (const x of mixAcrossSets(group, rng, ordered)) { if (out.length < count && !taken.has(x.id)) { taken.add(x.id); out.push(x.id); } }
  }
  return out;
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

/** A few of a test's own questions to show the AI as the style to write more in: taken round-robin
 *  from each set so every set is represented, shuffled within a set, cut down to the fields the
 *  generator needs. Only the test's sets are ever passed in, so the new questions stay about the test. */
export function pickSeedQuestions(sets, max = 14, rng = Math.random) {
  const lists = (sets || []).map((a) => {
    const qs = [...(a.questions || [])];
    for (let i = qs.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [qs[i], qs[j]] = [qs[j], qs[i]]; }
    return qs;
  });
  const out = [];
  for (let round = 0; out.length < max && lists.some((l) => l.length > round); round++) {
    for (const l of lists) { if (l[round] && out.length < max) out.push(l[round]); }
  }
  return out.map((q) => ({ kind: q.kind, topic: q.topic, prompt: q.prompt, choices: q.choices, answer: q.answer, explanation: q.explanation }));
}

const promptKey = (p) => String(p || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Generated questions that are not already in these sets (same prompt, ignoring case and punctuation)
 *  and not repeated within the batch itself. */
export function newQuestionsOnly(generated, sets) {
  const seen = new Set();
  for (const a of sets || []) for (const q of a.questions || []) seen.add(promptKey(q.prompt));
  const out = [];
  for (const q of generated || []) {
    const k = promptKey(q.prompt);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(q);
  }
  return out;
}

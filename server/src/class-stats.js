// A teacher's view of a class, computed from each student's synced state.
//
// Only what a student did on the sets assigned to the class is read out of
// their state — never the rest of it — and only per-set numbers and
// per-topic counts leave this module. "Known" means the same as everywhere
// else in the app: a question whose most recent answer was right first try.
// The state itself is not read here: state-digest.js keeps each student's last answer to every
// question, and that is all this needs.

/**
 * How one student is doing on one set.
 * `set` is { questions: [{ id, topic }] } from library-data.js; `digest` is the student's
 * state summary (state-digest.js), or null if they've never synced.
 * → { total, seen, known, lastAt, topics: { [topic]: { answered, wrong } } }
 */
export function studentSetProgress(digest, set) {
  const answers = digest?.answers && typeof digest.answers === "object" ? digest.answers : {};
  let lastAt = 0;
  let seen = 0;
  let known = 0;
  const topics = {};
  for (const q of set.questions) {
    if (!Object.hasOwn(answers, q.id)) continue;
    const [at, ok] = answers[q.id];
    seen++;
    if (at > lastAt) lastAt = at;
    if (ok) known++;
    const row = (topics[q.topic] ??= { answered: 0, wrong: 0 });
    row.answered++;
    if (!ok) row.wrong++;
  }
  return { total: set.questions.length, seen, known, lastAt: lastAt || null, topics };
}

/** Add every student's per-topic counts together: [{ topic, answered, wrong }],
 *  worst first. Topics with fewer than `minAnswered` answers are left out —
 *  two wrong answers out of two isn't a pattern. */
export function classTopics(perStudent, { minAnswered = 3 } = {}) {
  const sum = {};
  for (const p of perStudent) {
    for (const [topic, { answered, wrong }] of Object.entries(p.topics)) {
      const row = (sum[topic] ??= { topic, answered: 0, wrong: 0 });
      row.answered += answered;
      row.wrong += wrong;
    }
  }
  return Object.values(sum)
    .filter((r) => r.answered >= minAnswered && r.wrong > 0)
    .sort((a, b) => b.wrong / b.answered - a.wrong / a.answered || b.answered - a.answered);
}

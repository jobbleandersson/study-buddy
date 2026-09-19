// A teacher's view of a class, computed from each student's synced state.
//
// Only what a student did on the sets assigned to the class is read out of
// their state — never the rest of it — and only per-set numbers and
// per-topic counts leave this module. "Known" means the same as everywhere
// else in the app: a question whose most recent answer was right first try.

/**
 * How one student is doing on one set.
 * `set` is { questions: [{ id, topic }] } from library-data.js; `blob` is the
 * student's synced state (or null if they've never synced).
 * → { total, seen, known, lastAt, topics: { [topic]: { answered, wrong } } }
 */
export function studentSetProgress(blob, set) {
  const topicOf = new Map(set.questions.map((q) => [q.id, q.topic]));
  const latest = new Map(); // questionId -> { at, ok }
  let lastAt = 0;

  const attempts = Array.isArray(blob?.attempts) ? blob.attempts : [];
  for (const attempt of attempts) {
    const at = Number(attempt?.finishedAt) || 0;
    for (const item of Array.isArray(attempt?.items) ? attempt.items : []) {
      if (!topicOf.has(item?.questionId)) continue;
      if (at > lastAt) lastAt = at;
      const ok = item.firstTry ?? !!item.correct;
      const prev = latest.get(item.questionId);
      if (!prev || at >= prev.at) latest.set(item.questionId, { at, ok });
    }
  }

  let known = 0;
  const topics = {};
  for (const [qid, { ok }] of latest) {
    if (ok) known++;
    const topic = topicOf.get(qid);
    const row = (topics[topic] ??= { answered: 0, wrong: 0 });
    row.answered++;
    if (!ok) row.wrong++;
  }
  return { total: set.questions.length, seen: latest.size, known, lastAt: lastAt || null, topics };
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

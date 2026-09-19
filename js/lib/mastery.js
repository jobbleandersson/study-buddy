// Per-topic mastery, derived from attempt history.
// Recency-weighted average correctness in [0,1]; newer attempts count more.

/** Did the student get this item right on the first try? Scores, grades and
 *  mastery count this. A multiple-choice answer found after wrong picks is
 *  `correct` (the session celebrates it) but not `firstTry`. Items saved
 *  before `firstTry` existed fall back to `correct`. */
export function firstTryCorrect(item) {
  return item.firstTry ?? !!item.correct;
}

export function masteryByTopic(attempts, { half = 5 } = {}) {
  // gather per-topic list of {correct, age} where age = attempts-ago
  const byTopic = new Map();
  const ordered = [...attempts].sort((a, b) => (a.finishedAt || 0) - (b.finishedAt || 0));
  ordered.forEach((att, idx) => {
    const age = ordered.length - 1 - idx;
    for (const it of att.items || []) {
      if (!it.topic) continue;
      if (!byTopic.has(it.topic)) byTopic.set(it.topic, []);
      byTopic.get(it.topic).push({ correct: firstTryCorrect(it) ? 1 : 0, age });
    }
  });

  const out = {};
  for (const [topic, list] of byTopic) {
    let num = 0, den = 0;
    for (const { correct, age } of list) {
      const w = Math.pow(0.5, age / half);
      num += correct * w;
      den += w;
    }
    out[topic] = den ? num / den : 0;
  }
  return out;
}

// Mastery for a subject = mean of its topics' mastery (topics inferred from its assignments).
export function masteryForSubject(subjectId, assignments, topicMastery) {
  const topics = new Set();
  for (const a of assignments) {
    if (a.subjectId !== subjectId) continue;
    for (const q of a.questions || []) if (q.topic) topics.add(q.topic);
  }
  if (!topics.size) return null;
  let sum = 0, n = 0;
  for (const t of topics) { if (t in topicMastery) { sum += topicMastery[t]; n++; } }
  return n ? sum / n : null;
}

// Mastery for a single assignment given the current topic mastery map.
export function masteryForAssignment(assignment, topicMastery) {
  const topics = new Set((assignment.questions || []).map((q) => q.topic).filter(Boolean));
  if (!topics.size) return null;
  let sum = 0, n = 0;
  for (const t of topics) { if (t in topicMastery) { sum += topicMastery[t]; n++; } }
  return n ? sum / n : null;
}

// Snapshot before, apply one attempt, return {topic: {before, after}}.
// Only the topics this attempt actually covered — a Rome test shouldn't
// report on your photosynthesis topics just because they exist.
export function deltaFromAttempt(attempts, newAttempt) {
  const before = masteryByTopic(attempts);
  const after = masteryByTopic([...attempts, newAttempt]);
  const topics = new Set((newAttempt.items || []).map((i) => i.topic).filter(Boolean));
  const out = {};
  for (const t of topics) out[t] = { before: before[t] ?? 0, after: after[t] ?? 0 };
  return out;
}

/**
 * How one set is going, from every attempt that touched its questions.
 * A question is "known" when its most recent answer was right first try.
 * `weakTopic`/`weakCount` use the same threshold and "untouched isn't weak"
 * rule as weakSpotQuestions, so the card agrees with the weak-spots drill.
 * Pass a precomputed `topicMastery` to avoid re-walking every attempt per set.
 */
export function setProgress(assignment, attempts, topicMastery = masteryByTopic(attempts), { threshold = 0.6 } = {}) {
  const questions = assignment.questions || [];
  const ids = new Set(questions.map((q) => q.id));

  const latest = new Map(); // questionId -> { at, ok }
  let lastAt = 0;
  for (const att of attempts) {
    const at = att.finishedAt || 0;
    for (const it of att.items || []) {
      if (!ids.has(it.questionId)) continue;
      if (at > lastAt) lastAt = at;
      const prev = latest.get(it.questionId);
      if (!prev || at >= prev.at) latest.set(it.questionId, { at, ok: firstTryCorrect(it) });
    }
  }
  let known = 0;
  for (const v of latest.values()) if (v.ok) known++;

  let weakTopic = null, weakLevel = threshold, weakCount = 0;
  for (const q of questions) {
    const m = topicMastery[q.topic];
    if (m == null || m >= threshold) continue;
    weakCount++;
    if (m < weakLevel) { weakLevel = m; weakTopic = q.topic; }
  }

  return { total: ids.size, known, seen: latest.size, lastAt: lastAt || null, weakTopic, weakCount };
}

/**
 * Questions worth drilling because you keep getting their topic wrong.
 * Uses the same recency-weighted mastery as everything else, so it reflects
 * how you've been doing lately rather than your all-time average.
 *
 * Returns [{assignment, question, mastery}] weakest-topic first.
 */
export function weakSpotQuestions(assignments, attempts, { threshold = 0.6, limit = 20 } = {}) {
  const tm = masteryByTopic(attempts);
  const seen = new Set();
  const out = [];

  for (const a of assignments) {
    for (const q of a.questions || []) {
      const m = tm[q.topic];
      // Untouched topics have unknown mastery, not weak mastery — skip them.
      if (m == null || m >= threshold) continue;
      if (seen.has(q.id)) continue;
      seen.add(q.id);
      out.push({ assignment: a, question: q, mastery: m });
    }
  }

  out.sort((x, y) => x.mastery - y.mastery);
  return out.slice(0, limit);
}

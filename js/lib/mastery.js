// Per-topic mastery, derived from attempt history.
// Recency-weighted average correctness in [0,1]; newer attempts count more.

export function masteryByTopic(attempts, { half = 5 } = {}) {
  // gather per-topic list of {correct, age} where age = attempts-ago
  const byTopic = new Map();
  const ordered = [...attempts].sort((a, b) => (a.finishedAt || 0) - (b.finishedAt || 0));
  ordered.forEach((att, idx) => {
    const age = ordered.length - 1 - idx;
    for (const it of att.items || []) {
      if (!it.topic) continue;
      if (!byTopic.has(it.topic)) byTopic.set(it.topic, []);
      byTopic.get(it.topic).push({ correct: it.correct ? 1 : 0, age });
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

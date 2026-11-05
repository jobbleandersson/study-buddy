import { isUntouchedSample } from "./blank-questions.js";
// Per-topic mastery, derived from attempt history.
// Recency-weighted average correctness in [0,1]; newer attempts count more.

/** Did the student get this item right on the first try? Scores, grades and
 *  mastery count this. A multiple-choice answer found after wrong picks is
 *  `correct` (the session celebrates it) but not `firstTry`. Items saved
 *  before `firstTry` existed fall back to `correct`. */
export function firstTryCorrect(item) {
  return item.firstTry ?? !!item.correct;
}

/** The key a topic's mastery is kept under: the topic within its subject. 118 topic names are shared between
 *  subjects ("present tense" in German, French and Spanish, "diagram" in maths and DTK), and keyed by name alone
 *  a miss in one marked the others weak. Without a subject (a question whose set is gone) it is the bare name,
 *  which no subject's lookup matches. */
export const topicKey = (subjectId, topic) => (subjectId ? `${subjectId}␟${topic}` : topic);

/** questionId -> subjectId over these sets. */
function subjectsByQuestion(assignments) {
  const m = new Map();
  for (const a of assignments || []) for (const q of a.questions || []) if (!m.has(q.id)) m.set(q.id, a.subjectId);
  return m;
}

/** Recency-weighted mastery per topic, in [0,1]. Pass `assignments` (the student's sets) and it is keyed by
 *  topicKey(subject, topic), which is what every lookup below uses; without them, by bare topic name. */
export function masteryByTopic(attempts, { half = 5, assignments = null } = {}) {
  // gather per-topic list of {correct, age} where age = attempts-ago
  const byTopic = new Map();
  const subjectOf = assignments ? subjectsByQuestion(assignments) : null;
  const ordered = [...attempts].sort((a, b) => (a.finishedAt || 0) - (b.finishedAt || 0));
  ordered.forEach((att, idx) => {
    const age = ordered.length - 1 - idx;
    for (const it of att.items || []) {
      if (!it.topic) continue;
      const key = subjectOf ? topicKey(subjectOf.get(it.questionId), it.topic) : it.topic;
      if (!byTopic.has(key)) byTopic.set(key, []);
      byTopic.get(key).push({ correct: firstTryCorrect(it) ? 1 : 0, age });
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
// `topicMastery` from masteryByTopic(attempts, { assignments }).
export function masteryForSubject(subjectId, assignments, topicMastery) {
  const topics = new Set();
  for (const a of assignments) {
    if (a.subjectId !== subjectId) continue;
    for (const q of a.questions || []) if (q.topic) topics.add(q.topic);
  }
  if (!topics.size) return null;
  let sum = 0, n = 0;
  for (const t of topics) { const k = topicKey(subjectId, t); if (has(topicMastery, k)) { sum += topicMastery[k]; n++; } }
  return n ? sum / n : null;
}

// Own keys only: a topic named "constructor" or "toString" must not pick up Object's built-ins.
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** One question's topic mastery (undefined when never practised), from masteryByTopic(attempts, { assignments }). */
export const topicMasteryOf = (topicMastery, assignment, question) => {
  const k = topicKey(assignment?.subjectId, question?.topic);
  return question?.topic && has(topicMastery, k) ? topicMastery[k] : undefined;
};

// Mastery for a single assignment given the current topic mastery map.
export function masteryForAssignment(assignment, topicMastery) {
  const topics = new Set((assignment.questions || []).map((q) => q.topic).filter(Boolean));
  if (!topics.size) return null;
  let sum = 0, n = 0;
  for (const t of topics) { const k = topicKey(assignment.subjectId, t); if (has(topicMastery, k)) { sum += topicMastery[k]; n++; } }
  return n ? sum / n : null;
}

// Snapshot before, apply one attempt, return {topic: {before, after}} by topic name, for the results screen.
// Only the topics this attempt actually covered — a Rome test shouldn't
// report on your photosynthesis topics just because they exist. A name two subjects share in one mixed run
// gets the subject after it ("present tense (Franska)", via `subjectName`), so both show.
export function deltaFromAttempt(attempts, newAttempt, { assignments = null, subjectName = (id) => id } = {}) {
  const before = masteryByTopic(attempts, { assignments });
  const after = masteryByTopic([...attempts, newAttempt], { assignments });
  const subjectOf = assignments ? subjectsByQuestion(assignments) : null;
  const out = {};
  const keyOfLabel = new Map();   // label -> the mastery key it shows
  for (const it of newAttempt.items || []) {
    if (!it.topic) continue;
    const sid = subjectOf?.get(it.questionId);
    const k = subjectOf ? topicKey(sid, it.topic) : it.topic;
    if ([...keyOfLabel.values()].includes(k)) continue;
    const label = keyOfLabel.has(it.topic) ? `${it.topic} (${subjectName(sid) || sid})` : it.topic;
    keyOfLabel.set(label, k);
    out[label] = { before: before[k] ?? 0, after: after[k] ?? 0 };
  }
  return out;
}

/**
 * How one set is going, from every attempt that touched its questions.
 * A question is "known" when its most recent answer was right first try.
 * `weakTopic`/`weakCount` use the same threshold and "untouched isn't weak"
 * rule as weakSpotQuestions, so the card agrees with the weak-spots drill.
 * Pass a precomputed `topicMastery` to avoid re-walking every attempt per set.
 * `lastAnswers` (state.lastAnswers, lib/history.js) holds the latest result of questions whose attempts have
 * been shortened; it counts like an attempt that answered them then.
 */
export function setProgress(assignment, attempts, topicMastery = masteryByTopic(attempts, { assignments: [assignment] }), { threshold = 0.6, lastAnswers = null } = {}) {
  const questions = assignment.questions || [];
  const ids = new Set(questions.map((q) => q.id));

  const latest = new Map(); // questionId -> { at, ok }
  let lastAt = 0;
  if (lastAnswers && typeof lastAnswers === "object") {
    for (const id of ids) {
      const v = Object.prototype.hasOwnProperty.call(lastAnswers, id) ? lastAnswers[id] : null;
      if (!Array.isArray(v)) continue;
      const at = Number(v[0]) || 0;
      latest.set(id, { at, ok: v[1] === 1 });
      if (at > lastAt) lastAt = at;
    }
  }
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
    const m = topicMasteryOf(topicMastery, assignment, q);
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
export function weakSpotQuestions(assignments, attempts, { threshold = 0.6, limit = 20, allAssignments = assignments } = {}) {
  // Mastery over every set the student has (allAssignments), so a topic practised in another set of the same
  // subject still counts when only some sets are drilled.
  const tm = masteryByTopic(attempts, { assignments: allAssignments });
  const seen = new Set();
  const out = [];

  for (const a of assignments) {
    for (const q of a.questions || []) {
      if (isUntouchedSample(q)) continue;   // a placeholder is nothing to drill
      const m = topicMasteryOf(tm, a, q);
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

// "Minnesregler" — one-line rules a student writes in their own words after
// missing a question. Pure helpers, no DOM: the store owns the list, the
// question card offers the prompt, the rules page lists and prints them.
//
// A rule is { id, subjectId, subjectName, topic, questionId, text, createdAt,
// updatedAt?, peeks? }. subjectName is a snapshot, so a rule still reads
// properly if its subject is later deleted.

export const RULE_MAX_CHARS = 160;
export const RULE_MAX_COUNT = 300;

/** Trim, collapse runs of whitespace, cap the length. "" when nothing is left. */
export function cleanRuleText(raw) {
  return String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, RULE_MAX_CHARS);
}

/** Anything worth matching on — "general" is the generator's placeholder topic. */
export function hasTopic(topic) {
  const t = String(topic ?? "").trim().toLowerCase();
  return !!t && t !== "general" && t !== "allmänt";
}

/**
 * Does this rule belong to this question? Same subject and topic, or the very
 * question it was written for. A rule with no real topic only ever matches its
 * own question, so a catch-all "general" never spreads across a subject.
 */
export function ruleMatches(rule, subjectId, question) {
  if (!rule || !question) return false;
  if (rule.questionId && rule.questionId === question.id) return true;
  return hasTopic(rule.topic) && rule.subjectId === subjectId && rule.topic === question.topic;
}

/** Rules for a question, newest first. */
export function rulesForQuestion(rules, subjectId, question) {
  return (rules || [])
    .filter((r) => ruleMatches(r, subjectId, question))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/**
 * Group rules under their subject for the rules page: subjects in the order the
 * student has them (unknown ones last, by snapshot name), rules newest first.
 * Returns [{ subjectId, name, rules }].
 */
export function groupRules(rules, subjects) {
  const order = new Map((subjects || []).map((s, i) => [s.id, i]));
  const groups = new Map();
  for (const r of rules || []) {
    if (!groups.has(r.subjectId)) {
      const live = (subjects || []).find((s) => s.id === r.subjectId);
      groups.set(r.subjectId, { subjectId: r.subjectId, name: live?.name || r.subjectName || "", rules: [] });
    }
    groups.get(r.subjectId).rules.push(r);
  }
  const out = [...groups.values()];
  for (const g of out) g.rules.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  out.sort((a, b) => {
    const ai = order.has(a.subjectId) ? order.get(a.subjectId) : 1e6;
    const bi = order.has(b.subjectId) ? order.get(b.subjectId) : 1e6;
    return ai - bi || a.name.localeCompare(b.name);
  });
  return out;
}

/**
 * The question ids for a "repeat only my rules" session: for every rule the
 * question it was written for, plus other questions on the same subject and
 * topic. Deduped, only ids that still exist, capped. `pick` orders the pool
 * (the session passes a shuffle; tests pass identity).
 */
export function ruleQuestionIds(assignments, rules, { limit = 15, pick = (a) => a } = {}) {
  const byId = new Map();     // question id -> question
  const bySubject = new Map(); // subject id -> [question]
  for (const a of assignments || []) {
    for (const q of a.questions || []) {
      byId.set(q.id, q);
      if (!bySubject.has(a.subjectId)) bySubject.set(a.subjectId, []);
      bySubject.get(a.subjectId).push(q);
    }
  }
  const seen = new Set();
  const direct = [], related = [];
  for (const r of rules || []) {
    if (r.questionId && byId.has(r.questionId) && !seen.has(r.questionId)) {
      seen.add(r.questionId);
      direct.push(r.questionId);
    }
    if (!hasTopic(r.topic)) continue;
    for (const q of bySubject.get(r.subjectId) || []) {
      if (q.topic === r.topic && !seen.has(q.id)) { seen.add(q.id); related.push(q.id); }
    }
  }
  // The questions the rules were written for come first; fill the rest from
  // their topics. Each half is ordered by `pick`, then the whole list is capped.
  return [...pick(direct), ...pick(related)].slice(0, limit);
}

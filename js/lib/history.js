// How much study history is kept. Every finished set used to stay forever with every answer, and every save
// uploads the whole state: about 2.4 KB per 15-question set, so a student doing ten sets a day filled the
// browser's ~5 MB in about seven months (the server takes up to 10 MB), and a signed-out student then simply
// stopped saving. Now the newest KEEP_FULL attempts keep every answer; older ones keep what the statistics
// need — date, set, score, time, how many answered and right, which subjects — and each question's latest
// result moves to `lastAnswers`, so "known / seen" on set cards, test plans and the teacher view stay right.
// Topic mastery needs nothing more: it weights attempts by 0.5^(age/5), and one 300 attempts back counts for
// about 2^-60. Högskoleprov attempts are never shortened: the prognosis reads their answers.

export const KEEP_FULL = 300;

/** How many questions an attempt answered, whether or not it still has its answers. */
export const answeredCount = (a) => (Array.isArray(a?.items) ? a.items.length : Number(a?.answered) || 0);

/** How many of them were right first try. */
export const rightCount = (a) => (Array.isArray(a?.items)
  ? a.items.filter((it) => it && (it.firstTry ?? !!it.correct)).length
  : Number(a?.right) || 0);

/** `lastAnswers` holds { questionId: [atMs, 1|0] } (1 = right first try): the later answer wins. */
export function noteAnswer(lastAnswers, questionId, at, ok) {
  if (typeof questionId !== "string") return;
  const prev = lastAnswers[questionId];
  if (!Array.isArray(prev) || at >= prev[0]) lastAnswers[questionId] = [at, ok ? 1 : 0];
}

/**
 * Shorten every attempt but the newest KEEP_FULL (and never a Högskoleprov one) in place: its answers go into
 * state.lastAnswers and the attempt keeps a summary. Returns how many were shortened. Idempotent.
 */
// A Högskoleprov set (lib/hp.js isHpSetId; not imported: hp.js imports activity.js, which imports this file).
const isHpSet = (id) => /^lib-hp-/.test(String(id || ""));

export function compactAttempts(state, keep = KEEP_FULL) {
  const attempts = Array.isArray(state.attempts) ? state.attempts : [];
  const subjectOf = new Map();
  const hpQuestions = new Set();
  for (const s of state.assignments || []) {
    for (const q of s.questions || []) {
      if (!q) continue;
      if (!subjectOf.has(q.id)) subjectOf.set(q.id, s.subjectId);
      if (isHpSet(s.id)) hpQuestions.add(q.id);
    }
  }
  // Högskoleprov answers are read one by one by the prognosis and the delprov analysis, wherever they were
  // given (a Repetition run can hold HP questions), so an attempt with any of them stays whole.
  const touchesHp = (a) => a.hp || isHpSet(a.assignmentId) || a.items.some((it) => it && hpQuestions.has(it.questionId));
  const full = attempts.filter((a) => Array.isArray(a?.items) && !touchesHp(a));
  if (full.length <= keep) return 0;
  const byNewest = [...full].sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
  const old = new Set(byNewest.slice(keep));
  const setSubject = new Map((state.assignments || []).map((s) => [s.id, s.subjectId]));
  if (!state.lastAnswers || typeof state.lastAnswers !== "object" || Array.isArray(state.lastAnswers)) state.lastAnswers = {};

  state.attempts = attempts.map((a) => {
    if (!old.has(a)) return a;
    const at = a.finishedAt || 0;
    const subjects = new Set();
    if (setSubject.get(a.assignmentId)) subjects.add(setSubject.get(a.assignmentId));
    for (const it of a.items) {
      if (!it) continue;
      noteAnswer(state.lastAnswers, it.questionId, at, it.firstTry ?? !!it.correct);
      const sid = subjectOf.get(it.questionId);
      if (sid) subjects.add(sid);
    }
    const { items, unanswered, ...rest } = a;
    // right = right first try (scores, mastery); correct = right in the end (Framsteg's 30-day accuracy).
    const correct = a.items.filter((it) => it && it.correct === true).length;
    return { ...rest, answered: answeredCount(a), right: rightCount(a), correct, subjects: [...subjects], compact: true };
  });
  return old.size;
}

// Pure lookups over a library (assignments + srs), extracted from Store so
// they can also run against a fetched student's state blob for the
// parent/teacher dashboard — not just against store.state.

import { inReview } from "./srs.js";

/** Find a question anywhere in a set of assignments. Lets results and review
 *  sessions work without knowing which set a question came from. */
export function findQuestion(assignments, questionId) {
  for (const a of assignments) {
    const q = a.questions.find((x) => x.id === questionId);
    if (q) return { assignment: a, question: q };
  }
  return null;
}

/** The review pile, across all sets: every question whose spaced-repetition record came due in the
 *  last week (see REVIEW_WINDOW_DAYS in srs.js). Older ones have dropped out. */
export function dueQuestions(assignments, srs, now = Date.now()) {
  const out = [];
  for (const a of assignments) {
    for (const q of a.questions) {
      const rec = srs[q.id];
      if (inReview(rec, now)) out.push({ assignment: a, question: q, rec });
    }
  }
  return out.sort((x, y) => (x.rec?.dueAt || 0) - (y.rec?.dueAt || 0));
}

// Pure lookups over a library (assignments + srs), extracted from Store so
// they can also run against a fetched student's state blob for the
// parent/teacher dashboard — not just against store.state.

import { isDue } from "./srs.js";

/** Find a question anywhere in a set of assignments. Lets results and review
 *  sessions work without knowing which set a question came from. */
export function findQuestion(assignments, questionId) {
  for (const a of assignments) {
    const q = a.questions.find((x) => x.id === questionId);
    if (q) return { assignment: a, question: q };
  }
  return null;
}

/** Every question whose spaced-repetition record says it's due, across all sets. */
export function dueQuestions(assignments, srs, now = Date.now()) {
  const out = [];
  for (const a of assignments) {
    for (const q of a.questions) {
      const rec = srs[q.id];
      if (rec && isDue(rec, now)) out.push({ assignment: a, question: q, rec });
    }
  }
  return out.sort((x, y) => (x.rec?.dueAt || 0) - (y.rec?.dueAt || 0));
}

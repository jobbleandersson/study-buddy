// Pure helpers for the exam-mode question map and hand-in summary (views/session.js).
// No DOM, store or i18n imports, so they can be unit-tested and reused as they are.

/** One cell per question, in the fixed exam order.
 *  answered: an answer is recorded (it can still be changed until hand-in)
 *  flagged:  the student marked it to come back to
 *  current:  the question on screen */
export function examCells(order, items, flagged, cursor) {
  const flags = new Set(flagged || []);
  return (order || []).map((id, i) => ({
    id,
    n: i + 1,
    answered: !!(items && items[id]),
    flagged: flags.has(id),
    current: i === cursor,
  }));
}

/** Counts for the hand-in confirmation. `flaggedOpen` = flagged and still unanswered,
 *  the ones a student most likely forgot. */
export function examSummary(order, items, flagged) {
  const cells = examCells(order, items, flagged, -1);
  const answered = cells.filter((c) => c.answered).length;
  return {
    total: cells.length,
    answered,
    unanswered: cells.length - answered,
    flagged: cells.filter((c) => c.flagged).length,
    flaggedOpen: cells.filter((c) => c.flagged && !c.answered).length,
  };
}

/** Toggle an id in the flagged list without mutating it; returns the new list. */
export function toggleFlag(flagged, id) {
  const list = Array.isArray(flagged) ? flagged : [];
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

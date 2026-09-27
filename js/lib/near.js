// "Nästan där": the sets you have practised and got close on, but never finished with full marks.
// Pure — takes the store's assignments and attempts, returns what the home card lists.

/** Best score, attempt count and last-practised time per set, from real attempts at a set (review,
 *  weak-spot and national-mix runs have no set of their own to come back to, so they don't count).
 *  Returns the `limit` closest-to-full sets between `min` and 99 %, plus how many qualified. */
export function nearlyThere(assignments, attempts, { limit = 3, min = 50 } = {}) {
  const byId = new Map((assignments || []).map((a) => [a.id, a]));
  const stats = new Map();
  for (const at of attempts || []) {
    if (at.isReview) continue;
    const a = byId.get(at.assignmentId);
    if (!a) continue;
    const pct = Number(at.scorePct);
    if (!Number.isFinite(pct)) continue;
    const s = stats.get(a.id) || { assignment: a, best: 0, attempts: 0, last: 0 };
    s.best = Math.max(s.best, pct);
    s.attempts += 1;
    s.last = Math.max(s.last, Number(at.finishedAt || at.startedAt) || 0);
    stats.set(a.id, s);
  }
  const all = [...stats.values()]
    .filter((s) => s.best >= min && s.best < 100 && (s.assignment.questions?.length || 0) > 0)
    .sort((x, y) => y.best - x.best || y.last - x.last);
  return { items: all.slice(0, limit), total: all.length };
}

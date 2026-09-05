// Study-day bookkeeping.
//
// Two rules that the v1 code got wrong:
//   1. Days are LOCAL days. `toISOString()` is UTC, so studying at 00:30 in
//      Sweden was filed under yesterday.
//   2. The streak is DERIVED from the list of days studied, never stored.
//      A stored counter only updates when you finish a session, so it kept
//      showing "5 days" weeks after you last opened the app.

export function localDayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(dayKey, delta) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return localDayKey(dt);
}

export function daysBetween(a, b) {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((new Date(by, bm - 1, bd) - new Date(ay, am - 1, ad)) / 86400000);
}

/**
 * Consecutive days studied, counting back from today.
 * Today not studied yet is fine — the streak survives until the day ends,
 * so it only breaks once you've actually missed a full day.
 *
 * `frozenDays` are days a streak freeze was spent on: they count exactly like
 * a studied day for the walk-back, so a protected gap doesn't break the run.
 */
export function currentStreak(daysStudied, frozenDays = [], today = localDayKey()) {
  if (!daysStudied || !daysStudied.length) return 0;
  const days = new Set(daysStudied);
  const frozen = new Set(frozenDays || []);
  const counts = (d) => days.has(d) || frozen.has(d);
  let cursor = counts(today) ? today : addDays(today, -1);
  if (!counts(cursor)) return 0;
  let n = 0;
  while (counts(cursor)) { n++; cursor = addDays(cursor, -1); }
  return n;
}

export function studiedToday(daysStudied, today = localDayKey()) {
  return !!(daysStudied && daysStudied.includes(today));
}

/** Last N day keys, oldest first — for the streak strip. */
export function recentDays(n, today = localDayKey()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(addDays(today, -i));
  return out;
}

/** How many questions were answered in sessions finished today — the numerator
 *  of the daily goal. Counts answered items, not questions in the set. */
export function questionsAnsweredToday(attempts, today = localDayKey()) {
  let n = 0;
  for (const a of attempts || []) {
    if (a.finishedAt && localDayKey(new Date(a.finishedAt)) === today) {
      n += Array.isArray(a.items) ? a.items.length : 0;
    }
  }
  return n;
}

/** Score on each of the last N cross-set review sessions, oldest first — the
 *  "is my recall improving?" line on Progress. Reads only attempt.scorePct, so
 *  no mastery recompute; works retroactively on existing history. */
export function reviewAccuracyTrend(attempts, { limit = 12 } = {}) {
  return (attempts || [])
    .filter((a) => a.isReview && a.finishedAt && Array.isArray(a.items) && a.items.length)
    .sort((a, b) => a.finishedAt - b.finishedAt)
    .slice(-limit)
    .map((a) => ({ day: localDayKey(new Date(a.finishedAt)), pct: a.scorePct, n: a.items.length }));
}

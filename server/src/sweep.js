// Periodic cleanup of rows that have aged out. Started once from index.js.
//
// The sessions table (30-day TTL) and the two short-lived code tables never
// deleted their expired rows, so they grew for the life of the deployment.
// This is a single-process timer — fine at this scale; a multi-process
// deployment would run it from one worker or a cron.

import { db } from "./db.js";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
// Every few minutes, not hourly: the code tables take rows from any signed-in account, and an hour of
// them is a lot of disk if something loops. (codes.js also stops one account writing more than a few.)
export const SWEEP_EVERY_MS = Number(process.env.SWEEP_EVERY_MS) > 0 ? Number(process.env.SWEEP_EVERY_MS) : 5 * MINUTE;   // the env knob is for the tests
// The dashboard (routes/analytics.js) reads the last 30 days of page views; the rest only takes disk.
export const PAGE_VIEWS_KEEP_MS = 90 * DAY;

// [statement, the value it is given: a time, "now" or a cutoff].
const stmts = [
  [db.prepare("DELETE FROM sessions WHERE expires_at < ?"), (now) => now],
  [db.prepare("DELETE FROM invite_codes WHERE expires_at < ? OR used_at IS NOT NULL"), (now) => now],
  [db.prepare("DELETE FROM friend_codes WHERE expires_at < ? OR used_at IS NOT NULL"), (now) => now],
  [db.prepare("DELETE FROM email_verify_tokens WHERE expires_at < ? OR used_at IS NOT NULL"), (now) => now],
  [db.prepare("DELETE FROM password_reset_tokens WHERE expires_at < ? OR used_at IS NOT NULL"), (now) => now],
  [db.prepare("DELETE FROM twofa_challenges WHERE expires_at < ? OR used_at IS NOT NULL"), (now) => now],
  [db.prepare("DELETE FROM page_views WHERE created_at < ?"), (now) => now - PAGE_VIEWS_KEEP_MS],
];

/** One pass over every table; returns how many rows were removed. Exported for the tests. */
export function runSweep(now = Date.now()) {
  let removed = 0;
  for (const [stmt, value] of stmts) {
    try { removed += stmt.run(value(now)).changes; } catch (e) { console.warn("[sweep]", e.message); }
  }
  if (removed) console.log(`[sweep] removed ${removed} expired rows`);
  return removed;
}

export function startSweeper() {
  runSweep();
  setInterval(() => runSweep(), SWEEP_EVERY_MS).unref?.();
}

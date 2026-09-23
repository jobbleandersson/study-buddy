// Periodic cleanup of rows that have aged out. Started once from index.js.
//
// The sessions table (30-day TTL) and the two short-lived code tables never
// deleted their expired rows, so they grew for the life of the deployment.
// This is a single-process timer — fine at this scale; a multi-process
// deployment would run it from one worker or a cron.

import { db } from "./db.js";

const HOUR = 60 * 60 * 1000;

const stmts = [
  db.prepare("DELETE FROM sessions WHERE expires_at < ?"),
  db.prepare("DELETE FROM invite_codes WHERE expires_at < ? OR used_at IS NOT NULL"),
  db.prepare("DELETE FROM friend_codes WHERE expires_at < ? OR used_at IS NOT NULL"),
  db.prepare("DELETE FROM email_verify_tokens WHERE expires_at < ? OR used_at IS NOT NULL"),
  db.prepare("DELETE FROM password_reset_tokens WHERE expires_at < ? OR used_at IS NOT NULL"),
];

function runSweep() {
  const now = Date.now();
  let removed = 0;
  for (const s of stmts) {
    try { removed += s.run(now).changes; } catch (e) { console.warn("[sweep]", e.message); }
  }
  if (removed) console.log(`[sweep] removed ${removed} expired rows`);
}

export function startSweeper() {
  runSweep();
  setInterval(runSweep, HOUR).unref?.();
}

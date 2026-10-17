import { db } from "./db.js";
import { COOKIE_NAME } from "./constants.js";

// Sign-in sessions. One lasts 30 days from its last use and never more than 90 days from sign-in, so a
// student who opens the app every week stays signed in instead of being thrown out on day 30 with
// changes the server can no longer accept, and a stolen cookie still has a hard end.

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;   // at most one write a day per session

export function cookieOpts() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    maxAge: SESSION_TTL_MS,
    path: "/",
  };
}

/** Called for a session that was just found valid: pushes its end out to 30 days from now (capped at
 *  90 days from sign-in) when it has been more than a day since the last push, and refreshes the cookie. */
export function renewSession(res, sid, expiresAt, createdAt, now = Date.now()) {
  if (!sid || expiresAt - now > SESSION_TTL_MS - RENEW_AFTER_MS) return;
  const next = Math.min(now + SESSION_TTL_MS, (createdAt || now) + SESSION_MAX_AGE_MS);
  if (next <= expiresAt) return;
  db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").run(next, sid);
  res.cookie(COOKIE_NAME, sid, { ...cookieOpts(), maxAge: next - now });
}

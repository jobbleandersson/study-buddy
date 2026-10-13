// Tells the owner about unexpected server errors by email (ALERT_EMAIL, default the contact address),
// without ever letting a bug turn into a flood: the same error on the same route mails at most once an
// hour (the mail says how many more happened since), and at most ALERT_ERRORS_PER_DAY mails a day in
// all (default 10, 0 = no error mails). In memory and per process, like every limiter here, so a
// restart starts the counts over. Used by the 500 handler and the unhandled-rejection handler in
// index.js. It never throws and never waits: reporting a problem must not cause one.
//
// What a mail carries: the route (query string dropped, ids replaced), the error's message and the top
// of its stack. Never the request body, headers, cookies or who was signed in.

import { emailEnabled, sendServerErrorEmail } from "./email.js";

const PER_KEY_MS = 60 * 60_000;
const MAX_KEYS = 200;

const maxPerDay = () => {
  const raw = process.env.ALERT_ERRORS_PER_DAY;
  const n = Number(raw);
  return raw != null && raw.trim() !== "" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 10;
};

const seen = new Map();   // key -> { lastSent, suppressed }
let day = "";
let sentToday = 0;

/** "POST /api/reviews/5e1dfjnaqcrn?x=1" -> "POST /api/reviews/:id": nothing personal in an alert. */
export function routeLabel(method, rawPath) {
  const path = String(rawPath || "/").split("?")[0].split("/")
    .map((seg) => ((/\d/.test(seg) && seg.length >= 6) || seg.length > 40 ? ":id" : seg)).join("/").slice(0, 120);
  return `${String(method || "").toUpperCase()} ${path}`.trim();
}

/**
 * @returns "sent" | "suppressed" | "off" — what happened, for the tests; callers ignore it.
 * `send`, `now` and `enabled` exist so tests can supply their own mailer, clock and on/off.
 */
export function reportServerError({ where, err, send = sendServerErrorEmail, now = Date.now, enabled = emailEnabled() }) {
  try {
    const cap = maxPerDay();
    if (!enabled || cap === 0) return "off";

    const t = now();
    const today = new Date(t).toISOString().slice(0, 10);
    if (today !== day) { day = today; sentToday = 0; }

    const message = String(err?.message ?? err ?? "unknown error").replace(/\s+/g, " ").trim().slice(0, 300);
    const key = `${where}|${message.slice(0, 120)}`;
    const entry = seen.get(key) || { lastSent: 0, suppressed: 0 };

    if (t - entry.lastSent < PER_KEY_MS || sentToday >= cap) {
      entry.suppressed++;
      seen.set(key, entry);
      return "suppressed";
    }

    const stack = String(err?.stack || "").split("\n").slice(0, 8).join("\n").slice(0, 1500);
    const suppressed = entry.suppressed;
    entry.lastSent = t;
    entry.suppressed = 0;
    sentToday++;
    if (seen.size >= MAX_KEYS) seen.delete(seen.keys().next().value);
    seen.set(key, entry);

    Promise.resolve(send({ where, message, stack, suppressed, at: new Date(t).toISOString() })).catch(() => {});
    return "sent";
  } catch {
    return "off";
  }
}

/** Test-only: forget every count. */
export function _resetAlerts() { seen.clear(); day = ""; sentToday = 0; }

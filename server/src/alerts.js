// Tells the owner about unexpected server errors by email (ALERT_EMAIL, default the contact address),
// without ever letting a bug turn into a flood: the same error on the same route mails at most once an
// hour (the mail says how many more happened since), and at most ALERT_ERRORS_PER_DAY mails a day in
// all (default 10, 0 = no error mails). In memory and per process, like every limiter here, so a
// restart starts the counts over. Used by the 500 handler and the unhandled-rejection handler in
// index.js. It never throws and never waits: reporting a problem must not cause one.
//
// What a mail carries: the route (query string dropped, ids replaced), the error's message and the top
// of its stack. Never the request body, headers, cookies or who was signed in.

import { emailEnabled, sendServerErrorEmail, sendNewFeedbackEmail } from "./email.js";

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

// ---- new feedback (routes/feedback.js) ----
// One mail when feedback arrives after a quiet spell, then at most one every FEEDBACK_ALERT_MINUTES
// (default 30, 0 = no mails) carrying the count of what came in meanwhile, and at most
// FEEDBACK_ALERTS_PER_DAY a day (default 6; whatever is over waits for the next mail). What a mail carries:
// how many, of which kind, and a link to #/admin/feedback. Never the message or who sent it.
const num = (name, fallback) => {
  const raw = process.env[name];
  const n = Number(raw);
  return raw != null && raw.trim() !== "" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};
const emptyCounts = () => ({ idea: 0, problem: 0, praise: 0, other: 0 });
let fbPending = emptyCounts();
let fbLastSent = 0;
let fbTimer = null;
let fbDay = "";
let fbSentToday = 0;

/**
 * @returns "sent" | "queued" | "off" — for the tests; callers ignore it.
 * `send`, `now`, `enabled` and `schedule` exist so tests can supply their own mailer, clock, on/off and timer.
 */
export function reportNewFeedback({ kind, send = sendNewFeedbackEmail, now = Date.now, enabled = emailEnabled(), schedule = setTimeout }) {
  try {
    const windowMin = num("FEEDBACK_ALERT_MINUTES", 30);
    if (!enabled || windowMin === 0) return "off";
    fbPending[kind in fbPending ? kind : "other"]++;

    const windowMs = windowMin * 60_000;
    const flush = (t) => {
      const today = new Date(t).toISOString().slice(0, 10);
      if (today !== fbDay) { fbDay = today; fbSentToday = 0; }
      const total = Object.values(fbPending).reduce((a, b) => a + b, 0);
      if (!total || fbSentToday >= num("FEEDBACK_ALERTS_PER_DAY", 6)) return false;
      const counts = fbPending;
      fbPending = emptyCounts();
      fbLastSent = t;
      fbSentToday++;
      Promise.resolve(send({ counts, total, windowMin })).catch(() => {});
      return true;
    };

    const t = now();
    if (t - fbLastSent >= windowMs) return flush(t) ? "sent" : "queued";
    if (!fbTimer) {
      fbTimer = schedule(() => { fbTimer = null; flush(now()); }, fbLastSent + windowMs - t);
      fbTimer?.unref?.();
    }
    return "queued";
  } catch {
    return "off";
  }
}

/** Test-only: forget every count. */
export function _resetAlerts() {
  seen.clear(); day = ""; sentToday = 0;
  if (fbTimer) clearTimeout(fbTimer);
  fbPending = emptyCounts(); fbLastSent = 0; fbTimer = null; fbDay = ""; fbSentToday = 0;
}

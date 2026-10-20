// "Tyck till": what a student's feedback is made of, when we ask for it, and the one place it is sent
// from (the Tyck till page, the help panel and the card after a session all go through sendFeedback).
// Signed-in students only; "Skicka utan mitt konto" sends it without a link to the account.
// Server side: server/src/routes/feedback.js. The inbox is #/admin/feedback.

import { FEEDBACK_URL, MY_FEEDBACK_URL, myFeedbackUrl } from "../config.js";
import { coarseBrowser, sanitizeRoute, appVersion } from "./error-report.js";
import { serverMessage } from "./server-errors.js";
import { getLang } from "./i18n.js";

export const KINDS = ["idea", "problem", "praise", "other"];
export const MOODS = [1, 2, 3, 4, 5];
export const MESSAGE_MAX = 2000;
export const MESSAGE_MIN = 3;

// The card after a session is a favour, not a toll: not for someone who has barely started, and not
// again for a few days once they have answered or said "not now".
const ASK_MIN_SESSIONS = 3;
const ASK_EVERY_MS = 3 * 24 * 60 * 60_000;
const ASKED_KEY = "studify.feedbackAskedAt";

/** Whether the results screen should show "Hur gick passet?" now. */
export function shouldAskAfterSession({ authed, sessions, lastAskedAt, now = Date.now() }) {
  if (!authed || !(sessions >= ASK_MIN_SESSIONS)) return false;
  return !lastAskedAt || now - lastAskedAt >= ASK_EVERY_MS;
}

export function lastAskedAt() {
  try { return Number(localStorage.getItem(ASKED_KEY)) || 0; } catch { return 0; }
}
export function markAsked(now = Date.now()) {
  try { localStorage.setItem(ASKED_KEY, String(now)); } catch { /* private mode: it will ask again, harmlessly */ }
}

/** The JSON the server wants. `ctx` is where it was sent from (see feedbackContext). */
export function feedbackBody({ kind, message = "", mood = null, context = "button", anonymous = false }, ctx = {}) {
  const body = { kind, message: String(message).trim(), context };
  if (mood != null) body.mood = mood;
  if (anonymous) body.anonymous = true;
  if (ctx.route) body.route = ctx.route;
  if (ctx.lang) body.lang = ctx.lang;
  if (ctx.version) body.version = ctx.version;
  if (ctx.browser) body.browser = ctx.browser;
  return body;
}

/** Where it is sent from: the page (without a query string or ids), the language, the app version and the
 *  browser family. The same things an error report carries; nothing that identifies the student. */
export async function feedbackContext() {
  return {
    route: sanitizeRoute(typeof location !== "undefined" ? location.hash : ""),
    lang: getLang() === "en" ? "en" : "sv",
    version: await appVersion(),
    browser: coarseBrowser(typeof navigator !== "undefined" ? navigator.userAgent : ""),
  };
}

/** Sends one. Resolves to the new id; rejects with an Error whose message is already in the user's language. */
export async function sendFeedback(fields, fallback) {
  const res = await fetch(FEEDBACK_URL, {
    method: "POST", credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(feedbackBody(fields, await feedbackContext())),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(serverMessage(data?.error?.message, fallback));
  return data.id;
}

/** The student's own, newest first, with our status and reply. */
export async function loadMine() {
  const res = await fetch(MY_FEEDBACK_URL, { credentials: "include" });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()).feedback || [];
}

export async function takeBack(id) {
  const res = await fetch(myFeedbackUrl(id), { method: "DELETE", credentials: "include" });
  if (!res.ok) throw new Error(String(res.status));
}

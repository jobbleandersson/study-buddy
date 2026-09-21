// Dagens fråga — the student's side of the server calls, and a short-lived
// cache so the home page can redraw (it does, on every store change) without
// asking the server again each time.

import { MY_DAILY_URL, myDailyAnswerUrl } from "../config.js";
import { localDayKey } from "./activity.js";

const TTL_MS = 2 * 60 * 1000;
let cache = null;   // { day, at, items }

/** Today's question for each class the student is in. Never throws: signed out,
 *  an older server, offline — all just mean "no card". */
export async function fetchMyDaily({ force = false } = {}) {
  const day = localDayKey();
  if (!force && cache && cache.day === day && Date.now() - cache.at < TTL_MS) return cache.items;
  try {
    const res = await fetch(`${MY_DAILY_URL}?day=${encodeURIComponent(day)}`, { credentials: "include" });
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    const items = Array.isArray(data?.items) ? data.items : [];
    cache = { day, at: Date.now(), items };
    return items;
  } catch {
    return [];
  }
}

/** What's already known without a request — for the first paint. */
export function cachedDaily() {
  return cache && cache.day === localDayKey() && Date.now() - cache.at < TTL_MS ? cache.items : null;
}

export function forgetDaily() { cache = null; }

/**
 * Answer today's question. Resolves { result, streak, fresh } — `fresh` is false
 * when the server says it was answered before (409), in which case `result` is
 * the first answer. Throws an Error with the server's message otherwise.
 */
export async function answerDaily(id, choice) {
  const res = await fetch(myDailyAnswerUrl(id), {
    method: "POST", credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ choice }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 409 && data?.result) return { result: data.result, streak: null, fresh: false };
  if (!res.ok) throw new Error(data?.error?.message || "Something went wrong.");
  return { result: data.result, streak: data.streak ?? null, fresh: true };
}

/** Put a fresh answer into the cache so a redraw shows it at once. */
export function rememberAnswer(id, result, streak) {
  const item = cache?.items.find((i) => i.id === id);
  if (!item) return;
  item.result = result;
  if (streak != null) item.streak = streak;
  item.participation = { answered: result.answered, members: result.members };
}

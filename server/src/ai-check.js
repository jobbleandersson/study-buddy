// Is the AI actually working? `keyConfigured` in /api/health only says a key is set — on 2026-10-07 the
// key was set to an empty string by mistake and every AI feature failed while the site looked fine. This
// asks Anthropic for real (one output token on the cheapest model) and says why it failed:
//   checkAi()        -> { ok, reason, checkedAt }, cached for CACHE_MS so a monitor polling
//                       /api/health/ai (routes/health.js) costs next to nothing
//   startAiWatch()   checks on its own every AI_CHECK_EVERY_MIN minutes (default 6 h) and emails
//                    ALERT_EMAIL (default CONTACT_TO) when it breaks and again when it's back

import { sendAiAlertEmail, sendAiRecoveredEmail } from "./email.js";

const ANTHROPIC_URL = (process.env.NODE_ENV === "test" && process.env.ANTHROPIC_CHECK_URL) || "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";
const CACHE_MS = 10 * 60_000;

let cached = null;
let inflight = null;

/** reason: null | "no_key" | "key_rejected" | "no_credit" | "rate_limited" | "upstream_error" | "unreachable".
 *  "rate_limited" still counts as ok: the key works, it's only busy. */
export function checkAi({ fresh = false } = {}) {
  if (!fresh && cached && Date.now() - cached.checkedAt < CACHE_MS) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = (async () => {
    const key = process.env.ANTHROPIC_API_KEY;
    let reason = null;
    if (!key) {
      reason = "no_key";
    } else {
      try {
        const res = await fetch(ANTHROPIC_URL, {
          method: "POST",
          headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: MODEL, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          reason = res.status === 401 || res.status === 403 ? "key_rejected"
            : res.status === 429 ? "rate_limited"
            : res.status === 400 && /credit|billing/i.test(text) ? "no_credit"
            : "upstream_error";
        }
      } catch {
        reason = "unreachable";
      }
    }
    cached = { ok: !reason || reason === "rate_limited", reason, checkedAt: Date.now() };
    return cached;
  })().finally(() => { inflight = null; });
  return inflight;
}

const DAY = 24 * 60 * 60_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms).unref?.());

/** Checks every AI_CHECK_EVERY_MIN minutes (0 = off; off by default in tests). A failure is checked once
 *  more two minutes later before anyone is mailed, so a passing hiccup at Anthropic doesn't alert. One
 *  mail when it breaks, a reminder each day it stays broken, one when it works again. */
export function startAiWatch() {
  const fallback = process.env.NODE_ENV === "test" ? 0 : 360;
  const minutes = Number(process.env.AI_CHECK_EVERY_MIN ?? fallback);
  if (!(minutes > 0)) return;
  let alertedAt = 0;
  const run = async () => {
    try {
      let r = await checkAi({ fresh: true });
      if (!r.ok) { await sleep(120_000); r = await checkAi({ fresh: true }); }
      if (!r.ok) {
        if (Date.now() - alertedAt > DAY && await sendAiAlertEmail(r.reason)) alertedAt = Date.now();
      } else if (alertedAt) {
        await sendAiRecoveredEmail();
        alertedAt = 0;
      }
    } catch (e) {
      console.error("[ai-check] watch failed:", e);
    }
  };
  setTimeout(run, 60_000).unref?.();   // a minute after start: a deploy with a bad key is caught at once
  setInterval(run, minutes * 60_000).unref?.();
}

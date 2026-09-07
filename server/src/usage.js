// Per-user Claude token accounting + the monthly budget check.
//
// The proxy (routes/messages.js) is the only route that spends money, so the
// meter lives right next to it. One row per user per UTC calendar month in
// ai_usage; the budget is a flat token ceiling from env until entitlements
// (Phase 2) make it per-plan.

import { db } from "./db.js";

/** Default ceiling — generous enough that a heavy real student never hits it.
 *  Tune against a real cost model (see the "Turning on live mode" plan):
 *  roughly a generation ≈ 18k tokens, a tutor session ≈ 15k, grading is cheap. */
export const MONTHLY_TOKEN_BUDGET =
  Number(process.env.AI_MONTHLY_TOKEN_BUDGET) > 0
    ? Number(process.env.AI_MONTHLY_TOKEN_BUDGET)
    : 2_000_000;

/** Hard cap on output tokens per request, whatever the client asks for.
 *  16k covers the largest legitimate use (generateAssignment). */
export const MAX_OUTPUT_TOKENS =
  Number(process.env.AI_MAX_OUTPUT_TOKENS) > 0
    ? Number(process.env.AI_MAX_OUTPUT_TOKENS)
    : 16_000;

/** The models the proxy will forward. Anything else is a 400 — the client
 *  only ever asks for these three (see js/claude.js PRESETS). */
export const ALLOWED_MODELS = new Set([
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-haiku-4-5",
  "claude-haiku-4-5-20251001",
]);

/** "YYYY-MM" for the current UTC month. */
export function currentPeriod(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** First instant of next UTC month, as an epoch ms — when the budget resets. */
export function periodResetsAt(d = new Date()) {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

const readStmt = db.prepare(
  "SELECT input_tokens, output_tokens, request_count FROM ai_usage WHERE user_id = ? AND period = ?"
);

/** { inputTokens, outputTokens, totalTokens, requests } for this user this month. */
export function readUsage(userId, period = currentPeriod()) {
  const row = readStmt.get(userId, period);
  const input = row?.input_tokens ?? 0;
  const output = row?.output_tokens ?? 0;
  return { inputTokens: input, outputTokens: output, totalTokens: input + output, requests: row?.request_count ?? 0 };
}

const upsertStmt = db.prepare(`
  INSERT INTO ai_usage (user_id, period, input_tokens, output_tokens, request_count, updated_at)
  VALUES (@userId, @period, @input, @output, 1, @now)
  ON CONFLICT(user_id, period) DO UPDATE SET
    input_tokens  = input_tokens  + @input,
    output_tokens = output_tokens + @output,
    request_count = request_count + 1,
    updated_at    = @now
`);

/** Add one request's spend. Tolerant of missing/partial usage data (a stream
 *  that dropped, say) — a 0/0 row still counts the request. */
export function addUsage(userId, { inputTokens = 0, outputTokens = 0 } = {}) {
  upsertStmt.run({
    userId, period: currentPeriod(),
    input: Math.max(0, Math.round(inputTokens) || 0),
    output: Math.max(0, Math.round(outputTokens) || 0),
    now: Date.now(),
  });
}

/** { ok, used, limit, resetsAt } — call before forwarding a request. */
export function checkBudget(userId) {
  const used = readUsage(userId).totalTokens;
  return { ok: used < MONTHLY_TOKEN_BUDGET, used, limit: MONTHLY_TOKEN_BUDGET, resetsAt: periodResetsAt() };
}

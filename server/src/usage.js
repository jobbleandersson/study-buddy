// Per-user Claude token accounting + the monthly budget check, plus one
// account-wide spend counter with a daily dollar cap.
//
// The proxy (routes/messages.js) is the only route that spends money, so the
// meters live right next to it. One row per user per UTC calendar month in
// ai_usage; the per-user budget is a flat token ceiling from env until
// entitlements (Phase 2) make it per-plan. ai_spend_daily has one row per UTC
// day for the whole server, in estimated dollars: the backstop that holds no
// matter how many accounts exist.

import { db } from "./db.js";

/** Default ceiling for a free account: 200,000 tokens (input + output) a month —
 *  a few AI-made sets plus some tutor chat, and at most a few kronor of API spend
 *  even if all of it is set generation. (The old default, 2M, was sized so a heavy
 *  student never hit it, but one account could run up $3-$20 with it.) Tokens are
 *  a blunt meter: Sonnet output costs ten times Haiku input, so the daily dollar
 *  cap below is the real limit. A generation is roughly 9k tokens, a tutor session
 *  ~19k, grading ~1k. */
export const MONTHLY_TOKEN_BUDGET =
  Number(process.env.AI_MONTHLY_TOKEN_BUDGET) > 0
    ? Number(process.env.AI_MONTHLY_TOKEN_BUDGET)
    : 200_000;

/** Hard cap on output tokens per request, whatever the client asks for.
 *  16k covers the largest legitimate use (generateAssignment). */
export const MAX_OUTPUT_TOKENS =
  Number(process.env.AI_MAX_OUTPUT_TOKENS) > 0
    ? Number(process.env.AI_MAX_OUTPUT_TOKENS)
    : 16_000;

/** The models the proxy will forward. Anything else is a 400 — the client
 *  only ever asks for these two (see js/claude.js MODELS); enforced here too,
 *  not just by what the UI offers, so a tampered request can't spend at a
 *  pricier model's rate either. */
export const ALLOWED_MODELS = new Set([
  "claude-sonnet-5",
  "claude-haiku-4-5",
  "claude-haiku-4-5-20251001",
]);

// ---------- what a request costs ----------

/** Anthropic's list prices in USD per million tokens (checked 2026-09-21 against
 *  platform.claude.com/docs/en/about-claude/pricing). A million tokens at $1 is
 *  $1 per 1,000,000 tokens, so the price is also what one token costs in
 *  millionths of a dollar — which keeps the sums below in whole numbers
 *  ("micro-dollars"). Update this when a price or a model changes. */
export const PRICE_PER_MTOK = {
  "claude-sonnet-5": { in: 2, out: 10 },
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-haiku-4-5-20251001": { in: 1, out: 5 },
};
const PRICIEST = { in: 2, out: 10 };   // for a model that isn't listed: assume the dearer one

/** Estimated cost in micro-dollars of one request. `input` and `cacheRead`/`cacheWrite`
 *  are separate because the API's input_tokens leaves out anything read from or written to
 *  the prompt cache: a cache read costs 0.1x the input price, a write up to 2x (the 1-hour
 *  kind — assumed here, the dearer one). Thinking tokens arrive inside `output`. */
export function costMicroUsd(model, { input = 0, output = 0, cacheWrite = 0, cacheRead = 0 } = {}) {
  const p = PRICE_PER_MTOK[model] || PRICIEST;
  return Math.round(input * p.in + output * p.out + cacheWrite * p.in * 2 + cacheRead * p.in * 0.1);
}

// ---------- per-user monthly tokens ----------

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

// ---------- the account-wide daily dollar cap ----------

function capFromEnv() {
  const raw = process.env.AI_DAILY_SPEND_CAP_USD;
  if (raw == null || raw.trim() === "") return 5;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 5;
}

/** Most the whole server may spend on Claude in one UTC day, in USD (estimated
 *  from token counts). Past it, /api/messages answers 503 until 00:00 UTC for
 *  everyone, however many accounts are asking. 0 turns the cap off. */
export const DAILY_SPEND_CAP_USD = capFromEnv();
const CAP_MICRO = Math.round(DAILY_SPEND_CAP_USD * 1_000_000);

/** "YYYY-MM-DD" for the current UTC day. */
export function currentDay(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

/** First instant of the next UTC day, as an epoch ms — when the cap resets. */
export function dayResetsAt(d = new Date()) {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

const daySpendStmt = db.prepare("SELECT cost_micro, request_count FROM ai_spend_daily WHERE day = ?");
const addSpendStmt = db.prepare(`
  INSERT INTO ai_spend_daily (day, cost_micro, input_tokens, output_tokens, request_count, updated_at)
  VALUES (@day, @cost, @input, @output, 1, @now)
  ON CONFLICT(day) DO UPDATE SET
    cost_micro    = cost_micro    + @cost,
    input_tokens  = input_tokens  + @input,
    output_tokens = output_tokens + @output,
    request_count = request_count + 1,
    updated_at    = @now
`);

/** { costMicro, requests } for a UTC day (default: today). */
export function readDaySpend(day = currentDay()) {
  const row = daySpendStmt.get(day);
  return { costMicro: row?.cost_micro ?? 0, requests: row?.request_count ?? 0 };
}

// A request is only booked when it finishes, which for a long generation can be
// many seconds. Checking the cap against finished spend alone would let any number
// of parallel requests in before the first one is counted, so every admitted request
// also holds its worst-case cost here until it is done (in memory: it only has to
// cover requests in flight, and a restart drops those anyway).
let inflightMicro = 0;

/** What a request could cost at most: it may write all of max_tokens, and it reads
 *  an input about the size the body suggests. In micro-dollars. */
export function worstCaseMicro(model, { maxTokens, inputTokens }) {
  return costMicroUsd(model, { input: inputTokens, output: maxTokens });
}

/** Hold `micro` against the cap; returns the function that releases it. */
export function reserveSpend(micro) {
  inflightMicro += micro;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    inflightMicro = Math.max(0, inflightMicro - micro);
  };
}

/** { ok, spentMicro, capMicro, resetsAt } — call before forwarding a request, with that
 *  request's worst-case cost. ok means finished spend + requests in flight + this one
 *  still fit under the cap. */
export function checkDailyCap(extraMicro = 0) {
  const spentMicro = readDaySpend().costMicro;
  return {
    ok: !CAP_MICRO || spentMicro + inflightMicro + extraMicro < CAP_MICRO,
    spentMicro, capMicro: CAP_MICRO, resetsAt: dayResetsAt(),
  };
}

// One warning line per threshold per day (per process) — `fly logs` is where
// these are read; grep for "spend-alert".
const usd = (micro) => `$${(micro / 1_000_000).toFixed(2)}`;
const alerted = new Set();
function alertIfNeeded(day, spentMicro) {
  if (!CAP_MICRO) return;
  for (const fraction of [0.5, 0.8, 1]) {
    const key = `${day}:${fraction}`;
    if (spentMicro < CAP_MICRO * fraction || alerted.has(key)) continue;
    alerted.add(key);
    if (fraction >= 1) {
      console.error(`[spend-alert] daily AI spend cap reached (${usd(spentMicro)} of ${usd(CAP_MICRO)}); AI is paused until 00:00 UTC`);
    } else {
      console.warn(`[spend-alert] daily AI spend at ${Math.round(fraction * 100)}% (${usd(spentMicro)} of ${usd(CAP_MICRO)})`);
    }
  }
}

/**
 * Book one finished request: the user's monthly tokens (if there is a user) and
 * the server's daily dollars. `usage` is { input, output, cacheWrite, cacheRead }
 * as the API reported it. The per-user meter counts every input token, cached
 * or not, so a client can't hide spend behind cache_control. Returns the
 * request's estimated cost in micro-dollars.
 */
export function recordUsage({ userId, model, usage }) {
  const input = usage.input + usage.cacheWrite + usage.cacheRead;

  const costMicro = costMicroUsd(model, usage);
  const day = currentDay();
  addSpendStmt.run({
    day, cost: costMicro,
    input: Math.max(0, Math.round(input) || 0),
    output: Math.max(0, Math.round(usage.output) || 0),
    now: Date.now(),
  });
  alertIfNeeded(day, readDaySpend(day).costMicro);

  // The user's own meter goes last, and its failure is contained. The money has already been spent
  // at this point, so the server-wide tally and the cap alert above must not depend on it - and a
  // request can outlive its account (someone deletes theirs while a long answer is still streaming;
  // ai_usage.user_id is a foreign key, so the upsert is refused). Losing that one row costs nothing:
  // the account it belonged to is gone.
  if (userId) {
    try {
      addUsage(userId, { inputTokens: input, outputTokens: usage.output });
    } catch (e) {
      if (!/FOREIGN KEY/i.test(String(e?.message)) && e?.code !== "SQLITE_CONSTRAINT_FOREIGNKEY") throw e;
    }
  }
  return costMicro;
}

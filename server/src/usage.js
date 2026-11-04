// What Claude costs, and the limits that keep it bounded. The proxy (routes/messages.js) is the only
// route that spends money, so the meters live right next to it. The limits, from the everyday one out:
//
//   1. each account's month, in kronor (ai_usage, one row per user per UTC month): 2 kr free, 30 kr Plus,
//      0.25 kr until the account's email address is confirmed;
//   2. each account's UTC day: 5 kr, whatever the plan (in memory);
//   3. all unconfirmed accounts together: $1 a UTC day (in memory), so throwaway sign-ups can't add up;
//   4. the whole server: $50 a UTC day (ai_spend_daily), an emergency brake that mails the owner on the way.
//
// Only 4 stops AI for everyone, and with 1-3 in place it should only trip when something is wrong.

import { db } from "./db.js";

/** Kronor per US dollar, for turning what Claude costs (priced in dollars) into the kronor the monthly limits are
 *  written in. Set AI_KR_PER_USD to follow the exchange rate; 10 is close to the October 2026 rate. */
export const KR_PER_USD = Number(process.env.AI_KR_PER_USD) > 0 ? Number(process.env.AI_KR_PER_USD) : 10;

const krFromEnv = (name, fallback) => (Number(process.env[name]) > 0 ? Number(process.env[name]) : fallback);

/** What a free account's AI may cost in a month, in kronor: 2 kr. A tutor answer costs about half an öre and a
 *  generated set about ten öre, so 2 kr is roughly 40 sets or 400 tutor answers on Haiku, or two Högskoleprov
 *  batches on Sonnet. The limit is on money, not tokens: a Sonnet token costs 20 to 50 times a Haiku token, so a
 *  token count let the same allowance cost 4 cents or $1.20 depending on the model. */
export const MONTHLY_BUDGET_KR = krFromEnv("AI_FREE_BUDGET_KR", 2);

/** The same for an account on the paid plan (PluggEra Plus, see billing.js): 30 kr, so that even a user who spends all
 *  of it leaves something of a 45 kr payment. The server-wide daily dollar cap below remains the backstop. */
export const PLUS_BUDGET_KR = krFromEnv("AI_PLUS_BUDGET_KR", 30);

/** What an account may use before its email address is confirmed: 0.25 kr, about five sets or fifty tutor answers.
 *  Enough to try the AI while the confirmation mail is on its way, but a throwaway sign-up no longer gets a whole
 *  month. Confirming lifts the account to its normal limit (the spend so far still counts). */
export const UNVERIFIED_BUDGET_KR = krFromEnv("AI_UNVERIFIED_BUDGET_KR", 0.25);

/** Micro-dollars -> kronor. */
export const microToKr = (micro) => (micro / 1_000_000) * KR_PER_USD;
const krToMicro = (kr) => (kr / KR_PER_USD) * 1_000_000;

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
  "claude-haiku-5-5",
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
  // Two rate cards: $0.10 / $0.50 up to a 100K-token prompt, $0.50 / $2.50 above (checked 2026-10-07).
  "claude-haiku-5-5": { in: 0.1, out: 0.5, long: { from: 100_000, in: 0.5, out: 2.5 } },
};
const PRICIEST = { in: 2, out: 10 };   // for a model that isn't listed: assume the dearer one

/** Estimated cost in micro-dollars of one request. `input` and `cacheRead`/`cacheWrite`
 *  are separate because the API's input_tokens leaves out anything read from or written to
 *  the prompt cache: a cache read costs 0.1x the input price, a write up to 2x (the 1-hour
 *  kind — assumed here, the dearer one). Thinking tokens arrive inside `output`. */
export function costMicroUsd(model, { input = 0, output = 0, cacheWrite = 0, cacheRead = 0 } = {}) {
  let p = PRICE_PER_MTOK[model] || PRICIEST;
  // A model priced by prompt length: the whole request is billed at the long rate past the threshold.
  if (p.long && input + cacheRead + cacheWrite > p.long.from) p = p.long;
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
  "SELECT input_tokens, output_tokens, request_count, cost_micro FROM ai_usage WHERE user_id = ? AND period = ?"
);

/** { inputTokens, outputTokens, totalTokens, requests, costMicro, costKr } for this user this month. */
export function readUsage(userId, period = currentPeriod()) {
  const row = readStmt.get(userId, period);
  const input = row?.input_tokens ?? 0;
  const output = row?.output_tokens ?? 0;
  const costMicro = row?.cost_micro ?? 0;
  return { inputTokens: input, outputTokens: output, totalTokens: input + output, requests: row?.request_count ?? 0, costMicro, costKr: microToKr(costMicro) };
}

const upsertStmt = db.prepare(`
  INSERT INTO ai_usage (user_id, period, input_tokens, output_tokens, request_count, cost_micro, updated_at)
  VALUES (@userId, @period, @input, @output, 1, @cost, @now)
  ON CONFLICT(user_id, period) DO UPDATE SET
    input_tokens  = input_tokens  + @input,
    output_tokens = output_tokens + @output,
    request_count = request_count + 1,
    cost_micro    = cost_micro    + @cost,
    updated_at    = @now
`);

/** Add one request's spend. Tolerant of missing/partial usage data (a stream
 *  that dropped, say) — a 0/0 row still counts the request. */
export function addUsage(userId, { inputTokens = 0, outputTokens = 0, costMicro = 0 } = {}) {
  upsertStmt.run({
    userId, period: currentPeriod(),
    input: Math.max(0, Math.round(inputTokens) || 0),
    output: Math.max(0, Math.round(outputTokens) || 0),
    cost: Math.max(0, Math.round(costMicro) || 0),
    now: Date.now(),
  });
}

const emailOfStmt = db.prepare("SELECT email, email_verified_at AS verifiedAt, email_verify_required AS verifyRequired FROM users WHERE id = ?");

/** Accounts that skip the per-account monthly token ceiling: the owner and the people testing the product,
 *  listed by email in AI_BUDGET_EXEMPT_EMAILS (comma-separated; empty by default, so nobody is exempt).
 *  Only this per-account ceiling is lifted - every request is still metered and booked, and the
 *  server-wide daily dollar cap below applies to everyone, so this can't run up an unbounded bill. */
export function isBudgetExempt(userId) {
  const list = String(process.env.AI_BUDGET_EXEMPT_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!userId || !list.length) return false;
  const row = emailOfStmt.get(userId);
  // The address has to be proven where it could be: otherwise anyone who knew a listed address that
  // had no account yet could sign up with it and skip the ceiling.
  if (!row || (row.verifyRequired && !row.verifiedAt)) return false;
  return list.includes(String(row.email).toLowerCase());
}

/** The account's address could have been confirmed at sign-up and still isn't. Accounts made before email was
 *  switched on (email_verify_required NULL) count as confirmed, like in routes/auth.js looksPreRegistered: they
 *  are the real early users, and nothing was ever sent to them to confirm. Google and Apple sign-ins arrive
 *  confirmed. While email is switched off (no RESEND_API_KEY) nobody counts as unconfirmed: no link could be sent,
 *  so the trial would otherwise hold those accounts for good. */
export function isUnconfirmed(userId) {
  if (!userId || !process.env.RESEND_API_KEY) return false;
  const row = emailOfStmt.get(userId);
  return !!row && !!row.verifyRequired && !row.verifiedAt;
}

// What the requests that are running now could cost at most, per account. The monthly meter is only booked when a
// request finishes, so without this three requests started together all see the same "used" and can each add a
// whole answer. Held in memory, like the in-flight dollars below.
const microInFlight = new Map();
/** Hold a request's worst-case cost against the account's monthly limit while it runs; returns the release. */
export function reserveUserBudget(userId, micro) {
  microInFlight.set(userId, (microInFlight.get(userId) || 0) + micro);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const n = (microInFlight.get(userId) || 0) - micro;
    if (n > 0) microInFlight.set(userId, n); else microInFlight.delete(userId);
  };
}

/** { ok, used, limit, resetsAt } in kronor — call before forwarding a request. `limit` is the account's own limit
 *  (billing.js budgetFor: the Plus one for a subscriber), the free one by default. `used` is what is booked; requests
 *  still running count toward `ok` at their worst case (one request that starts under the limit may still finish over
 *  it, but a second one started alongside it is refused). */
export function checkBudget(userId, limitKr = MONTHLY_BUDGET_KR) {
  const used = readUsage(userId).costKr;
  const held = microToKr(microInFlight.get(userId) || 0);
  return { ok: used + held < limitKr, used: Math.round(used * 1000) / 1000, limit: limitKr, resetsAt: periodResetsAt() };
}

// ---------- the account-wide daily dollar cap ----------

// A number from the environment where 0 means "off": unset, empty, negative or not a number falls back.
function numOrOff(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Most the whole server may spend on Claude in one UTC day, in USD (estimated
 *  from token counts). Past it, /api/messages answers 503 until 00:00 UTC for
 *  everyone, however many accounts are asking. 0 turns the cap off.
 *
 *  An emergency brake, not the everyday limit: every account has its own monthly and daily limit, so this only
 *  trips when something is wrong (a bug that loops, a farm of accounts). $50 is about 500 kr, the whole month of
 *  roughly 7,500 free accounts spread over 30 days, and the owner is mailed at 50% and 80% (alerts.js). */
export const DAILY_SPEND_CAP_USD = numOrOff("AI_DAILY_SPEND_CAP_USD", 50);
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

// ---------- one account's daily limit ----------
// Most one account may use in a UTC day (spent + in flight, worst case for the request being asked), in kronor,
// whatever its plan: 5 kr. A free account never gets near it (its whole month is 2 kr); it bounds a Plus account, or
// an exempt one with no monthly limit, if someone else gets hold of it. Fixed, not a share of the server's cap,
// so raising the emergency brake doesn't raise it too. AI_USER_DAILY_KR=0 turns it off. In memory, like the
// other limiters here: a restart starts the day's count over, and the monthly limit (in the database) still holds.
export const USER_DAILY_KR = numOrOff("AI_USER_DAILY_KR", 5);
const USER_DAILY_MICRO = krToMicro(USER_DAILY_KR);
const userDay = { day: "", spent: new Map(), inflight: new Map() };
function rollUserDay() {
  const day = currentDay();
  if (userDay.day !== day) { userDay.day = day; userDay.spent.clear(); }
}
/** Would `extraMicro` more keep this account within its daily limit? */
export function checkUserDaily(userId, extraMicro = 0) {
  if (!USER_DAILY_MICRO || !userId) return true;
  rollUserDay();
  const used = (userDay.spent.get(userId) || 0) + (userDay.inflight.get(userId) || 0);
  return used + extraMicro <= USER_DAILY_MICRO;
}
/** Hold a request's worst case against the account's daily limit while it runs; returns the release. */
export function reserveUserSpend(userId, micro) {
  userDay.inflight.set(userId, (userDay.inflight.get(userId) || 0) + micro);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const n = (userDay.inflight.get(userId) || 0) - micro;
    if (n > 0) userDay.inflight.set(userId, n); else userDay.inflight.delete(userId);
  };
}
function bookUserSpend(userId, micro) {
  rollUserDay();
  userDay.spent.set(userId, (userDay.spent.get(userId) || 0) + micro);
}

// ---------- what unconfirmed accounts may use together ----------
// Each unconfirmed account has a small trial (UNVERIFIED_BUDGET_KR), but sign-ups cost nothing, so a script could
// make hundreds. All unconfirmed accounts together share this pool per UTC day: $1 by default, about 40 people
// trying the AI fully on their first day. Past it, unconfirmed accounts wait for tomorrow or confirm their
// address, and confirmed students are never affected. AI_UNVERIFIED_DAILY_USD=0 turns the pool off. In memory.
export const UNVERIFIED_DAILY_USD = numOrOff("AI_UNVERIFIED_DAILY_USD", 1);
const POOL_MICRO = Math.round(UNVERIFIED_DAILY_USD * 1_000_000);
const pool = { day: "", spent: 0, inflight: 0 };
function rollPool() {
  const day = currentDay();
  if (pool.day !== day) { pool.day = day; pool.spent = 0; }
}
/** Would `extraMicro` more keep the unconfirmed accounts within today's pool? */
export function checkUnverifiedPool(extraMicro = 0) {
  if (!POOL_MICRO) return true;
  rollPool();
  return pool.spent + pool.inflight + extraMicro <= POOL_MICRO;
}
/** Hold an unconfirmed account's request against the pool while it runs; returns the release. */
export function reserveUnverifiedPool(micro) {
  pool.inflight += micro;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pool.inflight = Math.max(0, pool.inflight - micro);
  };
}

// ---------- telling the owner ----------
// One log line per threshold per day (per process) — `fly logs` is where these are read; grep for
// "spend-alert" — and a mail to the owner (alerts.js reportAiSpend, which keeps its own once-a-day-per-kind
// rule). At 50% and 80% of booked spend; "paused" goes when the first request of the day is turned away
// (routes/messages.js), since the brake counts requests in flight at their worst case and so can trip
// before booked spend reaches 100%.
const usd = (micro) => `$${(micro / 1_000_000).toFixed(2)}`;
const alerted = new Set();
let onSpendAlert = () => {};
/** routes/messages.js passes alerts.js reportAiSpend here; usage.js stays free of the mail code (and of its imports in the unit tests). */
export function setSpendAlert(fn) { onSpendAlert = typeof fn === "function" ? fn : () => {}; }
function alertIfNeeded(day, spentMicro) {
  if (!CAP_MICRO) return;
  for (const fraction of [0.5, 0.8]) {
    const key = `${day}:${fraction}`;
    if (spentMicro < CAP_MICRO * fraction || alerted.has(key)) continue;
    alerted.add(key);
    console.warn(`[spend-alert] daily AI spend at ${Math.round(fraction * 100)}% (${usd(spentMicro)} of ${usd(CAP_MICRO)})`);
    try { onSpendAlert({ kind: fraction === 0.5 ? "half" : "most", spentUsd: spentMicro / 1_000_000, spentKr: microToKr(spentMicro), capUsd: DAILY_SPEND_CAP_USD }); } catch { /* never let a mail break booking */ }
  }
}
/** The brake (kind "paused") or the unconfirmed pool ("pool") has just turned a request away: log it and tell the owner. */
export function reportRefusal(kind) {
  const day = currentDay();
  const key = `${day}:${kind}`;
  if (alerted.has(key)) return;
  alerted.add(key);
  const spentMicro = readDaySpend(day).costMicro;
  if (kind === "paused") console.error(`[spend-alert] daily AI spend cap reached (${usd(spentMicro)} spent, ${usd(inflightMicro)} in flight, of ${usd(CAP_MICRO)}); AI is paused until 00:00 UTC`);
  else console.warn(`[spend-alert] unconfirmed accounts used today's pool (${usd(pool.spent)} of ${usd(POOL_MICRO)})`);
  try { onSpendAlert({ kind, spentUsd: spentMicro / 1_000_000, spentKr: microToKr(spentMicro), capUsd: DAILY_SPEND_CAP_USD, poolUsd: UNVERIFIED_DAILY_USD }); } catch { /* as above */ }
}

/**
 * Book one finished request: the user's monthly tokens (if there is a user) and
 * the server's daily dollars. `usage` is { input, output, cacheWrite, cacheRead }
 * as the API reported it. The per-user meter counts every input token, cached
 * or not, so a client can't hide spend behind cache_control. Returns the
 * request's estimated cost in micro-dollars. `unverified`: the account was unconfirmed when the request
 * was admitted, so the cost also comes off the unconfirmed accounts' pool.
 */
export function recordUsage({ userId, model, usage, unverified = false }) {
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
  if (userId) bookUserSpend(userId, costMicro);
  if (unverified) { rollPool(); pool.spent += costMicro; }

  // The user's own meter goes last, and its failure is contained. The money has already been spent
  // at this point, so the server-wide tally and the cap alert above must not depend on it - and a
  // request can outlive its account (someone deletes theirs while a long answer is still streaming;
  // ai_usage.user_id is a foreign key, so the upsert is refused). Losing that one row costs nothing:
  // the account it belonged to is gone.
  if (userId) {
    try {
      addUsage(userId, { inputTokens: input, outputTokens: usage.output, costMicro });
    } catch (e) {
      if (!/FOREIGN KEY/i.test(String(e?.message)) && e?.code !== "SQLITE_CONSTRAINT_FOREIGNKEY") throw e;
    }
  }
  return costMicro;
}

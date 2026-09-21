// A tiny in-memory per-user token bucket. Enough for one Node process; a
// multi-process deployment would need shared state (Redis) — noted in the
// plan as a Phase 4 concern.

const RATE_PER_MIN =
  Number(process.env.AI_RATE_PER_MIN) > 0 ? Number(process.env.AI_RATE_PER_MIN) : 20;

const REFILL_PER_MS = RATE_PER_MIN / 60_000;
const buckets = new Map(); // userId -> { tokens, last }

// Keep the map from growing without bound on a long-lived process.
setInterval(() => {
  const now = Date.now();
  for (const [id, b] of buckets) if (now - b.last > 10 * 60_000) buckets.delete(id);
}, 5 * 60_000).unref?.();

/** Returns true if this request is allowed (and spends a token). */
export function takeToken(userId) {
  const now = Date.now();
  let b = buckets.get(userId);
  if (!b) { b = { tokens: RATE_PER_MIN, last: now }; buckets.set(userId, b); }
  b.tokens = Math.min(RATE_PER_MIN, b.tokens + (now - b.last) * REFILL_PER_MS);
  b.last = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

export { RATE_PER_MIN };

// ---- named buckets for everything that isn't the AI proxy -------------------
// Logins, sign-ups and invite/class-code guesses used to have no limit at all:
// unlimited password guesses (each one also a bcrypt compare, i.e. CPU) and
// unlimited code guesses. A key like "login:email:a@b.se" gets `capacity`
// attempts up front and one more every `perMs` milliseconds.
const named = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of named) if (now - b.last > 60 * 60_000) named.delete(k);
}, 10 * 60_000).unref?.();

/** True if this attempt is allowed (and spends a token). */
export function takeKey(key, capacity, perMs) {
  const now = Date.now();
  let b = named.get(key);
  if (!b) { b = { tokens: capacity, last: now }; named.set(key, b); }
  b.tokens = Math.min(capacity, b.tokens + (now - b.last) / perMs);
  b.last = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

/** The caller's address — Fly's own header first (we sit behind its proxy), then Express's view. */
export function clientIp(req) {
  return String(req.headers["fly-client-ip"] || req.ip || "unknown");
}

/** The one message the client translates for a throttled attempt (js/lib/server-errors.js). */
export const TOO_MANY_MESSAGE = "Too many attempts. Wait a few minutes and try again.";
export function tooMany(res) {
  return res.status(429).json({ error: { message: TOO_MANY_MESSAGE, code: "rate_limited" } });
}

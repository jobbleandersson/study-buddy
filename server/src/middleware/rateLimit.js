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

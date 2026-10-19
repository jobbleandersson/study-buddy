// What a Claude request costs, in kronor: the client's copy of the price table in server/src/usage.js (dollars per
// million tokens) and its KR_PER_USD, so a screen can say "this check cost about 1/40 of your month" in the same unit
// as the monthly limit, which is in kronor. Approximate by design (the server's own booking is the truth); keep the
// numbers in step with the server's when a price or the exchange rate changes.

export const KR_PER_USD = 10;

const PRICE_PER_MTOK = {
  "claude-sonnet-5": { in: 2, out: 10 },
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-haiku-4-5-20251001": { in: 1, out: 5 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5 },
};
const PRICIEST = { in: 2, out: 10 };   // a model that is not listed: assume the dearer one, as the server does

/** Kronor for one request's usage ({ input_tokens, output_tokens } from the API). */
export function costKr(model, usage) {
  const p = PRICE_PER_MTOK[model] || PRICIEST;
  const usd = ((usage?.input_tokens || 0) * p.in + (usage?.output_tokens || 0) * p.out) / 1e6;
  return usd * KR_PER_USD;
}

// PluggEra Plus: the paid plan. Stripe does the checkout and the card; this file is the server's side of
// it - which accounts count as Plus, checking that a webhook really came from Stripe, and the three calls
// the server makes to Stripe's API.
//
// No Stripe SDK: the API is plain form-encoded HTTPS and a webhook signature is one HMAC, so a few dozen
// lines of fetch and crypto replace a dependency. STRIPE_API_BASE exists for the tests, which point it at a
// local stand-in.
//
// The whole feature is off until STRIPE_SECRET_KEY is set (billingEnabled). With a TEST key (sk_test_...)
// only the accounts already on the unmetered list (AI_BUDGET_EXEMPT_EMAILS) may start a checkout, so a
// test-mode rollout is invisible to everyone else; a live key opens it to all.

import crypto from "node:crypto";
import { db } from "./db.js";
import { isBudgetExempt, PLUS_TOKEN_BUDGET, MONTHLY_TOKEN_BUDGET } from "./usage.js";

const secretKey = () => process.env.STRIPE_SECRET_KEY || "";
const apiBase = () => (process.env.STRIPE_API_BASE || "https://api.stripe.com").replace(/\/+$/, "");

export const billingEnabled = () => !!secretKey() && !!process.env.STRIPE_PRICE_ID;
export const isTestMode = () => secretKey().startsWith("sk_test_");

/** May this account start a checkout? Everyone when live; only the listed testers on a test key. */
export function canCheckout(userId) {
  if (!billingEnabled()) return false;
  return isTestMode() ? isBudgetExempt(userId) : true;
}

/** Stripe subscription statuses that count as Plus. A failed renewal (past_due) keeps Plus while Stripe
 *  retries the card - cutting someone off for a bounced payment they will fix tomorrow is worse than a
 *  few days of allowance; when retries run out Stripe moves it to canceled or unpaid and Plus ends. */
const PLUS_STATUSES = new Set(["active", "trialing", "past_due"]);
export const isPlusStatus = (status) => PLUS_STATUSES.has(status);

const rowStmt = db.prepare(
  `SELECT stripe_customer_id AS customerId, stripe_subscription_id AS subscriptionId, status,
          current_period_end AS periodEnd, cancel_at_period_end AS cancelAtPeriodEnd, last_event_at AS lastEventAt,
          last_checkout_session AS lastCheckoutSession, updated_at AS updatedAt
   FROM subscriptions WHERE user_id = ?`
);

/** What Stripe last told us about this account, or null if it never started a checkout. */
export function subscriptionOf(userId) {
  const r = rowStmt.get(userId);
  return r ? { ...r, cancelAtPeriodEnd: !!r.cancelAtPeriodEnd } : null;
}

/** Is this account on Plus right now? Also false if the paid period has run out and the cancel event has
 *  not arrived (a missed webhook must not leave Plus on forever). */
export function isPlus(userId) {
  const s = subscriptionOf(userId);
  if (!s || !isPlusStatus(s.status)) return false;
  return s.periodEnd == null || s.periodEnd + GRACE_MS > Date.now();
}
const GRACE_MS = 3 * 24 * 3600_000;   // renewals post a little late; do not drop Plus on the stroke of the period end

// ---------- webhook signatures ----------

/** Check a Stripe-Signature header against the raw request body. The header looks like
 *  "t=1700000000,v1=<hex>,v1=<hex>": the signed text is "<t>.<body>", HMAC-SHA256 with the endpoint's
 *  signing secret. A timestamp more than `toleranceSec` away is refused, so a captured webhook cannot be
 *  replayed later. */
export function verifyStripeSignature(rawBody, header, secret, { toleranceSec = 300, now = Date.now() } = {}) {
  if (!secret || !header || !Buffer.isBuffer(rawBody)) return false;
  const parts = String(header).split(",").map((p) => p.trim().split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!/^\d+$/.test(t || "") || !sigs.length) return false;
  if (Math.abs(now / 1000 - Number(t)) > toleranceSec) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.`).update(rawBody).digest();
  return sigs.some((hex) => {
    if (!/^[0-9a-f]{64}$/i.test(hex)) return false;
    return crypto.timingSafeEqual(Buffer.from(hex, "hex"), expected);
  });
}

// ---------- applying an event ----------

const upsertStmt = db.prepare(`
  INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, cancel_at_period_end, updated_at, last_event_at)
  VALUES (@userId, @customerId, @subscriptionId, @status, @periodEnd, @cancel, @now, @at)
  ON CONFLICT(user_id) DO UPDATE SET
    stripe_customer_id     = COALESCE(@customerId, stripe_customer_id),
    stripe_subscription_id = COALESCE(@subscriptionId, stripe_subscription_id),
    status                 = @status,
    current_period_end     = COALESCE(@periodEnd, current_period_end),
    cancel_at_period_end   = @cancel,
    updated_at             = @now,
    last_event_at          = CASE WHEN @at IS NULL THEN last_event_at
                                  WHEN last_event_at IS NULL OR @at > last_event_at THEN @at
                                  ELSE last_event_at END
`);
const userByIdStmt = db.prepare("SELECT id FROM users WHERE id = ?");
const userByCustomerStmt = db.prepare("SELECT user_id AS id FROM subscriptions WHERE stripe_customer_id = ?");
const seenStmt = db.prepare("INSERT OR IGNORE INTO stripe_events (id, received_at) VALUES (?, ?)");

// Newer API versions moved the period end from the subscription onto its items.
const periodEndMs = (sub) => {
  const s = sub?.current_period_end ?? sub?.items?.data?.[0]?.current_period_end;
  return Number.isFinite(Number(s)) && s != null ? Number(s) * 1000 : null;
};

function userIdFor({ metadataUserId, customerId }) {
  if (metadataUserId && userByIdStmt.get(metadataUserId)) return metadataUserId;
  if (customerId) return userByCustomerStmt.get(customerId)?.id || null;
  return null;
}

/** Is this event older than what the account already reflects? Stripe does not promise to deliver events
 *  in the order they happened, so a late "updated" must not undo a newer "deleted" (a cancelled plan
 *  coming back to life), nor the old subscription's "deleted" cancel a new one a returning customer
 *  started. Only judged when the event carries Stripe's `created` time, which every real one does. */
function isStale(existing, event, subscriptionId, isDeletion) {
  const at = eventAt(event);
  if (at == null || !existing) return false;
  if (existing.lastEventAt != null && at < existing.lastEventAt) return true;
  // The same second is not ordered: a cancelled subscription never comes back, so anything but its
  // own deletion that shows up afterwards for the same subscription is an old event arriving late.
  return existing.status === "canceled" && !!subscriptionId && existing.subscriptionId === subscriptionId && !isDeletion;
}
function eventAt(event) {
  return Number(event.created) > 0 ? Number(event.created) * 1000 : null;
}

// A refund only ends the plan when it is for a payment of the current billing period (with a few days of
// slack): refunding an old month after later ones were paid is someone tidying up, not leaving.
const REFUND_WINDOW_MS = 35 * 24 * 3600_000;

/** Does this event say a Plus customer's current payment was refunded in full? If so, who and which
 *  Stripe subscription has to end: { userId, subscriptionId }; otherwise null. A refund should end the
 *  plan whoever makes it - from the Stripe dashboard by hand, say, which knows nothing about our database.
 *  A partial refund (goodwill, a billing mistake) does not: the person still has the plan they paid for.
 *  Pure reading of the database; the caller does the cancelling at Stripe, then applyEvent records it. */
export function refundCancelTarget(event) {
  if (event?.type !== "charge.refunded") return null;
  const charge = event.data?.object || {};
  const full = charge.refunded === true || (Number(charge.amount) > 0 && Number(charge.amount_refunded) >= Number(charge.amount));
  if (!full) return null;
  const userId = userIdFor({ customerId: charge.customer });
  if (!userId) return null;
  const sub = subscriptionOf(userId);
  if (!sub?.subscriptionId || !isPlusStatus(sub.status)) return null;
  // A refund that happened before the newest thing we know about the plan (a returning customer's new
  // subscription, say) was about the plan before it: a late or resent event must not cancel this one.
  // Known trade-off: last_event_at is "newest event applied", not "when this plan began", so a genuine
  // refund that is delivered after an unrelated newer subscription event is skipped too. Cancelling a
  // plan someone just paid for is the worse mistake; a skipped refund shows in Stripe's dashboard.
  const refundedAt = eventAt(event);
  if (refundedAt != null && sub.lastEventAt != null && refundedAt < sub.lastEventAt) return null;
  const paidAt = Number(charge.created) * 1000;
  if (sub.periodEnd != null && Number.isFinite(paidAt) && paidAt < sub.periodEnd - REFUND_WINDOW_MS) return null;
  return { userId, subscriptionId: sub.subscriptionId };
}

/** The same question for a chargeback (charge.dispute.created): the cardholder asked their bank to take the
 *  money back, so the plan ends - like a full refund, without waiting for how the dispute turns out. A dispute
 *  carries only the charge's id, not who paid, so the caller looks the charge up at Stripe first (getCharge)
 *  and passes it in; `charge.customer` is the link to the account. Only a payment of the current billing
 *  period counts, as for refunds. Returns { userId, subscriptionId } or null. */
export function disputeCancelTarget(event, charge) {
  if (event?.type !== "charge.dispute.created" || !charge) return null;
  const userId = userIdFor({ customerId: charge.customer });
  if (!userId) return null;
  const sub = subscriptionOf(userId);
  if (!sub?.subscriptionId || !isPlusStatus(sub.status)) return null;
  if (isStale(sub, event, sub.subscriptionId, false)) return null;
  const paidAt = Number(charge.created) * 1000;
  if (sub.periodEnd != null && Number.isFinite(paidAt) && paidAt < sub.periodEnd - REFUND_WINDOW_MS) return null;
  return { userId, subscriptionId: sub.subscriptionId };
}

/** Apply one verified webhook event. Returns what was done (for the log and the tests):
 *  "duplicate" (seen before), "stale" (older than what is already known), "ignored" (a kind we do not
 *  use, or an account that no longer exists), or "updated". Never throws for an unfamiliar event -
 *  Stripe sends many kinds and a 4xx would make it retry them for days. */
export const applyEvent = db.transaction((event, charge = null) => {
  if (!event?.id || !event?.type) return "ignored";
  if (seenStmt.run(event.id, Date.now()).changes === 0) return "duplicate";
  const obj = event.data?.object || {};

  if (event.type === "checkout.session.completed") {
    if (obj.mode !== "subscription") return "ignored";
    const userId = userIdFor({ metadataUserId: obj.client_reference_id, customerId: obj.customer });
    if (!userId) return "ignored";
    const existing = subscriptionOf(userId);
    if (isStale(existing, event, obj.subscription, false)) return "stale";
    // The subscription events carry the real status; this one just links the account to the Stripe
    // customer and subscription, so they can find it. Never downgrades a status already received for
    // THIS subscription; a different one (a returning customer's new plan) starts from scratch rather
    // than inheriting the old plan's "canceled". The status written here is only a placeholder, so this
    // event does not move last_event_at (at: null): otherwise the real subscription event Stripe created
    // a second earlier, if it arrives after this one, would be dropped as stale and leave a paying
    // customer on "incomplete".
    const sameSub = !!existing?.subscriptionId && existing.subscriptionId === obj.subscription;
    upsertStmt.run({
      userId, customerId: obj.customer || null, subscriptionId: obj.subscription || null,
      status: (sameSub && existing.status) || (!existing?.subscriptionId && existing?.status) || "incomplete",
      periodEnd: null, cancel: sameSub && existing?.cancelAtPeriodEnd ? 1 : 0, now: Date.now(), at: null,
    });
    // This checkout is done and linked: it no longer needs asking Stripe about (checkoutBlocker below).
    clearCheckoutStmt.run(userId, obj.id || null);
    return "updated";
  }

  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const userId = userIdFor({ metadataUserId: obj.metadata?.user_id, customerId: obj.customer });
    if (!userId) return "ignored";
    const deleted = event.type === "customer.subscription.deleted";
    if (isStale(subscriptionOf(userId), event, obj.id, deleted)) return "stale";
    upsertStmt.run({
      userId, customerId: obj.customer || null, subscriptionId: obj.id || null,
      status: deleted ? "canceled" : String(obj.status || "incomplete"),
      periodEnd: periodEndMs(obj), cancel: obj.cancel_at_period_end ? 1 : 0, now: Date.now(), at: eventAt(event),
    });
    return "updated";
  }

  // A full refund ends the plan (the route has already cancelled the subscription at Stripe): record it now,
  // so Plus stops at once rather than when the cancel event arrives.
  if (event.type === "charge.refunded") {
    const target = refundCancelTarget(event);
    if (!target) return "ignored";
    upsertStmt.run({ userId: target.userId, customerId: null, subscriptionId: null, status: "canceled", periodEnd: null, cancel: 0, now: Date.now(), at: eventAt(event) });
    return "updated";
  }

  // A chargeback ends the plan the same way (the route has already looked the charge up and cancelled at Stripe).
  if (event.type === "charge.dispute.created") {
    const target = disputeCancelTarget(event, charge);
    if (!target) return "ignored";
    upsertStmt.run({ userId: target.userId, customerId: null, subscriptionId: null, status: "canceled", periodEnd: null, cancel: 0, now: Date.now(), at: eventAt(event) });
    return "updated";
  }
  return "ignored";
});

// ---------- calls to Stripe ----------

/** Form-encode nested params the way Stripe wants them: { a: { b: 1 }, c: [x] } -> a[b]=1&c[0]=x. */
export function formEncode(params) {
  const out = [];
  const walk = (prefix, v) => {
    if (v == null) return;
    if (Array.isArray(v)) v.forEach((x, i) => walk(`${prefix}[${i}]`, x));
    else if (typeof v === "object") for (const [k, x] of Object.entries(v)) walk(`${prefix}[${k}]`, x);
    else out.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(v))}`);
  };
  for (const [k, v] of Object.entries(params)) walk(k, v);
  return out.join("&");
}

async function stripe(method, path, params) {
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers: { authorization: `Bearer ${secretKey()}`, "content-type": "application/x-www-form-urlencoded" },
    body: params ? formEncode(params) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Stripe's own message ("No such price...") goes to the log, never to the browser.
    throw Object.assign(new Error(`Stripe ${method} ${path} -> ${res.status}: ${json?.error?.message || "no message"}`), { status: res.status });
  }
  return json;
}

// Which Checkout session an account last started. A row made only for this (no subscription yet) is a
// placeholder: status "incomplete", no subscription id, so nothing treats it as a plan.
const rememberCheckoutStmt = db.prepare(`
  INSERT INTO subscriptions (user_id, status, updated_at, last_checkout_session) VALUES (?, 'incomplete', ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET last_checkout_session = excluded.last_checkout_session
`);
const clearCheckoutStmt = db.prepare("UPDATE subscriptions SET last_checkout_session = NULL WHERE user_id = ? AND last_checkout_session IS ?");

const PROCESSING_MS = 10 * 60_000;

/** Is a payment for this account already going through that we haven't been told about yet? If so a second
 *  checkout would buy the plan twice: someone pays, lands back on the site before Stripe's webhook has
 *  switched Plus on, and presses the button again. Returns "payment_processing" to refuse, or null to go
 *  ahead. Two signals: the "checkout completed" event linked a subscription whose own status hasn't followed
 *  yet, or Stripe says the session we last started is already complete. A session still open is expired, so
 *  it can't be paid later in another tab. Throws if Stripe can't be asked - the caller must not guess. */
export async function checkoutBlocker(userId) {
  const sub = subscriptionOf(userId);
  if (!sub) return null;
  if (sub.subscriptionId && sub.status === "incomplete" && Date.now() - sub.updatedAt < PROCESSING_MS) return "payment_processing";
  if (!sub.lastCheckoutSession) return null;
  let previous;
  try {
    previous = await stripe("GET", `/v1/checkout/sessions/${encodeURIComponent(sub.lastCheckoutSession)}`);
  } catch (e) {
    if (e.status === 404) return null;   // Stripe no longer knows it: nothing to pay
    throw e;
  }
  if (previous.status === "complete") {
    // The payment went through. If that subscription is already linked to the account (its events arrived,
    // even if the "checkout completed" one was dropped) there is nothing left to wait for: forget the session,
    // or a customer whose plan later ended would be refused here for good.
    if (typeof previous.subscription === "string" && previous.subscription === sub.subscriptionId) {
      clearCheckoutStmt.run(userId, sub.lastCheckoutSession);
      return null;
    }
    return "payment_processing";
  }
  if (previous.status === "open") await stripe("POST", `/v1/checkout/sessions/${encodeURIComponent(sub.lastCheckoutSession)}/expire`);
  return null;
}

/** A Checkout page for the Plus plan: { url, id }. `origin` is where the person comes back to (https://pluggera.se). */
export async function createCheckoutSession({ userId, email, origin }) {
  const existing = subscriptionOf(userId);
  const session = await stripe("POST", "/v1/checkout/sessions", {
    mode: "subscription",
    line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    client_reference_id: userId,
    // A returning customer keeps their Stripe customer; a new one is made from the account's email.
    ...(existing?.customerId ? { customer: existing.customerId } : { customer_email: email }),
    subscription_data: { metadata: { user_id: userId } },
    success_url: `${origin}/#/plus?paid=1`,
    cancel_url: `${origin}/#/plus`,
  });
  if (session.id) rememberCheckoutStmt.run(userId, Date.now(), session.id);
  return { url: session.url, id: session.id };
}

/** A charge as Stripe has it - a chargeback only names the charge, and the customer is on the charge. Throws if
 *  Stripe can't be asked, so the webhook fails and Stripe sends the event again rather than dropping it. */
export async function getCharge(chargeId) {
  return stripe("GET", `/v1/charges/${encodeURIComponent(chargeId)}`);
}

/** Stripe's own "manage or cancel your subscription" page for this customer. */
export async function createPortalSession({ customerId, origin }) {
  const session = await stripe("POST", "/v1/billing_portal/sessions", { customer: customerId, return_url: `${origin}/#/plus` });
  return session.url;
}

/** End a subscription right now (the account it belongs to is being deleted, or its payment was refunded).
 *  A subscription that is already gone or already cancelled at Stripe is fine - that is the goal. Returns
 *  false only if Stripe could not be reached or refused, so the caller can say so instead of silently
 *  leaving someone paying. */
export async function cancelSubscriptionNow(subscriptionId) {
  try {
    await stripe("DELETE", `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`);
    return true;
  } catch (e) {
    if (e.status === 404 || (e.status === 400 && /cancel/i.test(e.message))) return true;
    console.error("[billing] could not cancel subscription:", e.message);
    return false;
  }
}

/** The monthly token ceiling for this account: the Plus one for a subscriber, the free one otherwise. */
export const budgetFor = (userId) => (isPlus(userId) ? PLUS_TOKEN_BUDGET : MONTHLY_TOKEN_BUDGET);

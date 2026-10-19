import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { attemptLimit } from "../middleware/attemptLimit.js";
import {
  billingEnabled, isTestMode, canCheckout, isPlus, subscriptionOf, verifyStripeSignature, applyEvent, refundCancelTarget, disputeCancelTarget, getCharge, cancelSubscriptionNow,
  createCheckoutSession, createPortalSession, checkoutBlocker,
} from "../billing.js";
import { PLUS_BUDGET_KR, MONTHLY_BUDGET_KR } from "../usage.js";

export const billing = Router();

// Where Stripe sends people back to. Pinned to the site's own domain (CANONICAL_HOST) so a forged Host
// header cannot point a checkout's return link somewhere else; locally it falls back to the request's.
function originOf(req) {
  const host = process.env.CANONICAL_HOST;
  if (host) return `https://${host}`;
  return `${req.protocol}://${req.get("host")}`;
}

// Starting a checkout makes a call to Stripe each time, so it is throttled per account.
const checkoutLimit = attemptLimit({
  name: "billing-checkout", max: Number(process.env.BILLING_CALLS_PER_10MIN_PER_USER ?? 10) || 0, windowMs: 10 * 60_000,
  key: (req) => req.user?.userId,
});

const notAvailable = (res) => res.status(404).json({ error: { message: "Plus is not available.", code: "billing_off" } });

/** What the app needs to draw the Plus page and the settings line. Never leaks Stripe ids. */
billing.get("/billing/status", requireAuth, (req, res) => {
  const { userId } = req.user;
  const sub = subscriptionOf(userId);
  res.json({
    enabled: billingEnabled(),
    canCheckout: canCheckout(userId),
    testMode: isTestMode(),
    plus: isPlus(userId),
    renewsAt: sub?.periodEnd || null,
    cancelsAtPeriodEnd: !!sub?.cancelAtPeriodEnd,
    plusBudgetKr: PLUS_BUDGET_KR,
    freeBudgetKr: MONTHLY_BUDGET_KR,
    // True once there is a Stripe customer to open the management page for (also after a cancellation,
    // so the receipts are still reachable).
    hasCustomer: !!sub?.customerId,
  });
});

billing.post("/billing/checkout", requireAuth, checkoutLimit, asyncHandler(async (req, res) => {
  const { userId, email } = req.user;
  if (!canCheckout(userId)) return notAvailable(res);
  if (isPlus(userId)) {
    return res.status(409).json({ error: { message: "You already have Plus.", code: "already_plus" } });
  }
  try {
    // A payment that has gone through at Stripe but hasn't reached us yet must not be paid for twice.
    const blocked = await checkoutBlocker(userId);
    if (blocked) {
      return res.status(409).json({ error: { message: "Your payment is going through. Plus switches on in a moment.", code: blocked } });
    }
    const { url } = await createCheckoutSession({ userId, email, origin: originOf(req) });
    res.json({ url });
  } catch (e) {
    console.error("[billing] checkout failed:", e.message);
    res.status(502).json({ error: { message: "Couldn't reach the payment page. Try again in a moment.", code: "billing_unavailable" } });
  }
}));

billing.post("/billing/portal", requireAuth, checkoutLimit, asyncHandler(async (req, res) => {
  const { userId } = req.user;
  const sub = subscriptionOf(userId);
  if (!billingEnabled() || !sub?.customerId) return notAvailable(res);
  try {
    res.json({ url: await createPortalSession({ customerId: sub.customerId, origin: originOf(req) }) });
  } catch (e) {
    console.error("[billing] portal failed:", e.message);
    res.status(502).json({ error: { message: "Couldn't reach the payment page. Try again in a moment.", code: "billing_unavailable" } });
  }
}));

// Stripe's webhook. The body arrives RAW (index.js mounts express.raw on this path ahead of the JSON
// parser) because the signature covers the exact bytes. No session cookie: Stripe is the caller, and the
// signature is the only credential - an unsigned or stale request is a 400 and changes nothing.
billing.post("/stripe/webhook", async (req, res) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(404).end();
  if (!verifyStripeSignature(req.body, req.get("stripe-signature"), secret)) {
    return res.status(400).json({ error: { message: "Bad signature.", code: "bad_signature" } });
  }
  let event;
  try { event = JSON.parse(req.body.toString("utf8")); }
  catch { return res.status(400).json({ error: { message: "Bad JSON.", code: "bad_request" } }); }
  // Signed, but not an event object (a bare null, number or list): nothing to apply, and a 4xx or 5xx would
  // only make Stripe resend it for days. Answer 200 so it stops.
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    console.warn("[billing] webhook body is not an event object - ignored");
    return res.json({ received: true });
  }
  // The events this app acts on carry the object in data.object. An endpoint set up as "thin" sends only an
  // id, so the event would be silently dropped as unknown: say so in the log, where the cause can be found.
  if (typeof event.type === "string" && /^(checkout\.session|customer\.subscription|charge)\./.test(event.type)
      && !(event.data?.object && typeof event.data.object === "object")) {
    console.warn(`[billing] ${event.type} has no data.object - is the Stripe endpoint set to Snapshot (not Thin) payloads?`);
  }
  try {
    // A full refund ends the plan. Stop the billing at Stripe FIRST: if that fails the event is not recorded
    // as handled and we answer 500, so Stripe sends it again - recording it first would turn the retry into a
    // no-op and leave the customer being charged for a plan we had already ended on our side.
    // A chargeback (dispute) ends it too; it names only the charge, so look that up at Stripe first (a failure
    // throws, which is the same retry-by-500 below).
    let charge = null;
    const disputedCharge = event?.type === "charge.dispute.created" ? event.data?.object?.charge : null;
    if (typeof disputedCharge === "string" && disputedCharge) charge = await getCharge(disputedCharge);
    const ending = refundCancelTarget(event) || disputeCancelTarget(event, charge);
    if (ending && !(await cancelSubscriptionNow(ending.subscriptionId))) {
      return res.status(500).json({ error: { message: "Could not cancel the subscription.", code: "server_error" } });
    }
    const result = applyEvent(event, charge);
    console.log(`[billing] ${event.type} -> ${result}`);
    res.json({ received: true });
  } catch (e) {
    // 500 so Stripe retries: a database hiccup must not lose a payment.
    console.error("[billing] webhook failed:", e);
    res.status(500).json({ error: { message: "Could not process the event.", code: "server_error" } });
  }
});

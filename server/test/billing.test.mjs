import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { startServer, makeClient } from "./harness.mjs";

// PluggEra Plus: Stripe checkout, the webhook that makes an account Plus, and what Plus changes. Stripe
// itself is a local stand-in (STRIPE_API_BASE), so nothing here touches the network or a real key.

const SECRET = "whsec_test_secret";
const PERIOD = new Date().toISOString().slice(0, 7);
const BODY = { model: "claude-haiku-4-5", max_tokens: 5, messages: [{ role: "user", content: "hi" }] };

/** A stand-in for the three Stripe calls the server makes. `calls` records each one (path, method, form). */
async function startFakeStripe() {
  const calls = [];
  const fake = { calls, deleteStatus: 200, deleteMessage: null, sessionsCreated: [], sessionStatus: {}, sessionLookupStatus: 200 };
  const srv = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => { raw += d; });
    req.on("end", () => {
      const form = Object.fromEntries(new URLSearchParams(raw));
      calls.push({ method: req.method, path: req.url, form, auth: req.headers.authorization });
      res.setHeader("content-type", "application/json");
      if (req.method === "DELETE") {
        res.statusCode = fake.deleteStatus;
        return res.end(JSON.stringify(fake.deleteStatus === 200 ? { id: "sub_x", status: "canceled" } : { error: { message: fake.deleteMessage ?? "boom" } }));
      }
      const session = req.url.match(/^\/v1\/checkout\/sessions\/([^/?]+)(\/expire)?$/);
      if (session && fake.sessionLookupStatus !== 200) {
        res.statusCode = fake.sessionLookupStatus;
        return res.end(JSON.stringify({ error: { message: "lookup failed" } }));
      }
      if (session && req.method === "GET") return res.end(JSON.stringify({ id: session[1], status: fake.sessionStatus[session[1]] ?? "open" }));
      if (session && session[2] && req.method === "POST") { fake.sessionStatus[session[1]] = "expired"; return res.end(JSON.stringify({ id: session[1], status: "expired" })); }
      if (req.url === "/v1/checkout/sessions") {
        const id = `cs_test_${fake.sessionsCreated.length + 1}`;
        fake.sessionsCreated.push(id);
        return res.end(JSON.stringify({ id, url: "https://checkout.stripe.test/c/abc" }));
      }
      if (req.url === "/v1/billing_portal/sessions") return res.end(JSON.stringify({ url: "https://billing.stripe.test/p/abc" }));
      res.statusCode = 404; res.end("{}");
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  fake.url = `http://127.0.0.1:${srv.address().port}`;
  fake.stop = () => new Promise((r) => { srv.close(() => r()); srv.closeAllConnections?.(); });
  return fake;
}

const sign = (body, { secret = SECRET, t = Math.floor(Date.now() / 1000) } = {}) =>
  `t=${t},v1=${crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;

async function sendEvent(server, event, opts = {}) {
  const body = JSON.stringify(event);
  return fetch(`${server.baseUrl}/api/stripe/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": opts.header ?? sign(body, opts) },
    body,
  });
}

let evCounter = 0;
const subEvent = (type, userId, extra = {}) => ({
  id: `evt_${++evCounter}`, type,
  data: { object: {
    id: "sub_123", customer: "cus_123", status: "active", cancel_at_period_end: false,
    current_period_end: Math.floor(Date.now() / 1000) + 20 * 86400,
    metadata: { user_id: userId }, ...extra,
  } },
});

async function signUp(server, email) {
  const client = makeClient(server.baseUrl);
  const r = await client.post("/api/auth/signup", { email, password: "longenough1", consent: true });
  assert.equal(r.status, 200, `signup ${email}`);
  return { client, email, id: server.db.prepare("SELECT id FROM users WHERE email = ?").get(email).id };
}
const spend = (server, userId, tokens) => server.db.prepare(
  "INSERT INTO ai_usage (user_id, period, input_tokens, output_tokens, request_count, updated_at) VALUES (?, ?, ?, 0, 1, ?)"
).run(userId, PERIOD, tokens, Date.now());

describe("Plus is off until Stripe is configured", () => {
  let server, user;
  before(async () => { server = await startServer({ ANTHROPIC_API_KEY: "dummy" }); user = await signUp(server, "a@example.se"); });
  after(async () => { await server.stop(); });

  test("status says disabled, and checkout and the webhook are not there", async () => {
    const s = await user.client.get("/api/billing/status");
    assert.equal(s.status, 200);
    assert.equal(s.json.enabled, false);
    assert.equal(s.json.canCheckout, false);
    assert.equal((await user.client.post("/api/billing/checkout", {})).status, 404);
    assert.equal((await fetch(`${server.baseUrl}/api/stripe/webhook`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 404);
  });

  test("signed-out callers get 401", async () => {
    assert.equal((await makeClient(server.baseUrl).get("/api/billing/status")).status, 401);
    assert.equal((await makeClient(server.baseUrl).post("/api/billing/checkout", {})).status, 401);
  });
});

describe("with a test key", () => {
  let server, stripe, owner, regular;
  before(async () => {
    stripe = await startFakeStripe();
    server = await startServer({
      ANTHROPIC_API_KEY: "dummy",
      STRIPE_SECRET_KEY: "sk_test_abc", STRIPE_PRICE_ID: "price_test_99", STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_API_BASE: stripe.url,
      AI_MONTHLY_TOKEN_BUDGET: "1000", AI_PLUS_TOKEN_BUDGET: "5000",
      AI_BUDGET_EXEMPT_EMAILS: "owner@example.se",
    });
    owner = await signUp(server, "owner@example.se");
    regular = await signUp(server, "regular@example.se");
  });
  after(async () => { await server.stop(); await stripe.stop(); });

  test("only an account on the tester list can start a checkout", async () => {
    assert.equal((await regular.client.get("/api/billing/status")).json.canCheckout, false);
    assert.equal((await regular.client.post("/api/billing/checkout", {})).status, 404);
    assert.equal((await owner.client.get("/api/billing/status")).json.canCheckout, true);
  });

  test("checkout asks Stripe for a subscription on the configured price, tied to the account", async () => {
    const r = await owner.client.post("/api/billing/checkout", {});
    assert.equal(r.status, 200);
    assert.equal(r.json.url, "https://checkout.stripe.test/c/abc");
    const call = stripe.calls.find((c) => c.path === "/v1/checkout/sessions");
    assert.equal(call.auth, "Bearer sk_test_abc");
    assert.equal(call.form.mode, "subscription");
    assert.equal(call.form["line_items[0][price]"], "price_test_99");
    assert.equal(call.form.client_reference_id, owner.id);
    assert.equal(call.form["subscription_data[metadata][user_id]"], owner.id);
    assert.equal(call.form.customer_email, "owner@example.se");
    assert.match(call.form.success_url, /#\/plus\?paid=1$/);
  });

  describe("the webhook", () => {
    test("an unsigned, wrongly signed or stale request is refused and changes nothing", async () => {
      const ev = subEvent("customer.subscription.created", regular.id);
      assert.equal((await sendEvent(server, ev, { header: "" })).status, 400);
      assert.equal((await sendEvent(server, ev, { secret: "whsec_other" })).status, 400);
      assert.equal((await sendEvent(server, ev, { t: Math.floor(Date.now() / 1000) - 3600 })).status, 400);
      assert.equal(server.db.prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE user_id = ?").get(regular.id).n, 0);
    });

    test("a signed subscription event makes the account Plus: higher ceiling, shown on /usage and /billing/status", async () => {
      spend(server, regular.id, 3000);       // over the free 1,000, under the Plus 5,000
      assert.equal((await regular.client.post("/api/messages", BODY)).status, 402);

      const r = await sendEvent(server, subEvent("customer.subscription.created", regular.id));
      assert.equal(r.status, 200);

      const usage = await regular.client.get("/api/usage");
      assert.equal(usage.json.plus, true);
      assert.equal(usage.json.limit, 5000);
      assert.notEqual((await regular.client.post("/api/messages", BODY)).status, 402, "Plus gets past the free ceiling");
      const st = (await regular.client.get("/api/billing/status")).json;
      assert.equal(st.plus, true);
      assert.ok(st.renewsAt > Date.now());
      assert.equal(st.hasCustomer, true);
      assert.equal(JSON.stringify(st).includes("cus_123"), false, "no Stripe ids reach the browser");
    });

    test("Plus still has a ceiling of its own", async () => {
      const heavy = await signUp(server, "heavy@example.se");
      await sendEvent(server, subEvent("customer.subscription.created", heavy.id, { id: "sub_h", customer: "cus_h" }));
      spend(server, heavy.id, 6000);
      assert.equal((await heavy.client.post("/api/messages", BODY)).status, 402);
    });

    test("a repeated event is applied once", async () => {
      const ev = subEvent("customer.subscription.updated", regular.id, { cancel_at_period_end: true });
      assert.equal((await sendEvent(server, ev)).status, 200);
      assert.equal((await regular.client.get("/api/billing/status")).json.cancelsAtPeriodEnd, true);
      // Stripe resends the same id; a later change must not be undone by the replay
      await sendEvent(server, subEvent("customer.subscription.updated", regular.id, { cancel_at_period_end: false }));
      assert.equal((await sendEvent(server, ev)).status, 200);
      assert.equal((await regular.client.get("/api/billing/status")).json.cancelsAtPeriodEnd, false);
    });

    test("a failed renewal (past_due) keeps Plus; a deleted subscription ends it", async () => {
      await sendEvent(server, subEvent("customer.subscription.updated", regular.id, { status: "past_due" }));
      assert.equal((await regular.client.get("/api/billing/status")).json.plus, true);
      await sendEvent(server, subEvent("customer.subscription.deleted", regular.id, { status: "canceled" }));
      const st = (await regular.client.get("/api/billing/status")).json;
      assert.equal(st.plus, false);
      assert.equal((await regular.client.get("/api/usage")).json.limit, 1000);
      assert.equal((await regular.client.post("/api/messages", BODY)).status, 402);
    });

    test("Plus whose paid period ran out long ago ends even if the cancel event never came", async () => {
      const lapsed = await signUp(server, "lapsed@example.se");
      const longAgo = Math.floor(Date.now() / 1000) - 10 * 86400;
      await sendEvent(server, subEvent("customer.subscription.created", lapsed.id, { id: "sub_l", customer: "cus_l", current_period_end: longAgo }));
      assert.equal((await lapsed.client.get("/api/billing/status")).json.plus, false);
    });

    describe("events that arrive out of order (Stripe's `created` says which is newer)", () => {
      const at = (event, created) => ({ ...event, created });
      const isPlusNow = async (u) => (await u.client.get("/api/billing/status")).json.plus;

      test("a late 'updated' does not bring a cancelled subscription back", async () => {
        const u = await signUp(server, "late-update@example.se");
        const o = { id: "sub_late", customer: "cus_late" };
        await sendEvent(server, at(subEvent("customer.subscription.created", u.id, o), 1_800_000_000));
        await sendEvent(server, at(subEvent("customer.subscription.deleted", u.id, { ...o, status: "canceled" }), 1_800_000_200));
        assert.equal(await isPlusNow(u), false);
        await sendEvent(server, at(subEvent("customer.subscription.updated", u.id, o), 1_800_000_100));   // older, delivered late
        assert.equal(await isPlusNow(u), false);
      });

      test("in the same second, nothing but its own deletion follows a cancelled subscription", async () => {
        const u = await signUp(server, "same-second@example.se");
        const o = { id: "sub_same", customer: "cus_same" };
        await sendEvent(server, at(subEvent("customer.subscription.deleted", u.id, { ...o, status: "canceled" }), 1_800_000_500));
        await sendEvent(server, at(subEvent("customer.subscription.updated", u.id, o), 1_800_000_500));
        assert.equal(await isPlusNow(u), false);
      });

      test("the old subscription's late cancellation does not cancel the new one a returning customer started", async () => {
        const u = await signUp(server, "returning@example.se");
        await sendEvent(server, at(subEvent("customer.subscription.created", u.id, { id: "sub_old", customer: "cus_ret" }), 1_800_001_000));
        await sendEvent(server, at(subEvent("customer.subscription.created", u.id, { id: "sub_new", customer: "cus_ret" }), 1_800_003_000));
        assert.equal(await isPlusNow(u), true);
        await sendEvent(server, at(subEvent("customer.subscription.deleted", u.id, { id: "sub_old", customer: "cus_ret", status: "canceled" }), 1_800_002_000));
        assert.equal(await isPlusNow(u), true, "the old plan ending first in time, but arriving last, changes nothing");
      });

      test("a new plan after a cancellation starts from scratch, not as the old plan's 'canceled'", async () => {
        const u = await signUp(server, "resub@example.se");
        const old = { id: "sub_a", customer: "cus_resub" };
        await sendEvent(server, at(subEvent("customer.subscription.created", u.id, old), 1_800_010_000));
        await sendEvent(server, at(subEvent("customer.subscription.deleted", u.id, { ...old, status: "canceled" }), 1_800_010_100));
        await sendEvent(server, at({ id: `evt_${++evCounter}`, type: "checkout.session.completed", data: { object: {
          mode: "subscription", client_reference_id: u.id, customer: "cus_resub", subscription: "sub_b" } } }, 1_800_010_200));
        assert.equal(await isPlusNow(u), false, "linked, but nothing paid is known yet");
        // The new subscription's own events are not mistaken for the cancelled one's leftovers.
        await sendEvent(server, at(subEvent("customer.subscription.created", u.id, { id: "sub_b", customer: "cus_resub" }), 1_800_010_300));
        assert.equal(await isPlusNow(u), true);
      });

      test("the checkout event arriving first does not make the subscription's earlier 'active' stale", async () => {
        const u = await signUp(server, "checkout-first@example.se");
        await sendEvent(server, at({ id: `evt_${++evCounter}`, type: "checkout.session.completed", data: { object: {
          mode: "subscription", client_reference_id: u.id, customer: "cus_cf", subscription: "sub_cf" } } }, 1_800_020_101));
        assert.equal(await isPlusNow(u), false, "linked only: nothing paid is known yet");
        // Stripe made this a second BEFORE the checkout event, but it was delivered after it.
        await sendEvent(server, at(subEvent("customer.subscription.updated", u.id, { id: "sub_cf", customer: "cus_cf" }), 1_800_020_100));
        assert.equal(await isPlusNow(u), true, "the real status still lands");
      });
    });

    test("events for unknown accounts or kinds are acknowledged and ignored", async () => {
      assert.equal((await sendEvent(server, subEvent("customer.subscription.created", "no-such-user", { customer: "cus_nobody" }))).status, 200);
      assert.equal((await sendEvent(server, { id: `evt_${++evCounter}`, type: "charge.refunded", data: { object: {} } })).status, 200);
      assert.equal(server.db.prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE user_id = ?").get("no-such-user").n, 0);
    });

    test("checkout.session.completed links the Stripe customer but does not grant Plus by itself", async () => {
      const fresh = await signUp(server, "fresh@example.se");
      await sendEvent(server, { id: `evt_${++evCounter}`, type: "checkout.session.completed", data: { object: {
        mode: "subscription", client_reference_id: fresh.id, customer: "cus_f", subscription: "sub_f" } } });
      const st = (await fresh.client.get("/api/billing/status")).json;
      assert.equal(st.hasCustomer, true);
      assert.equal(st.plus, false);
    });
  });

  test("someone already on Plus cannot start a second checkout", async () => {
    await sendEvent(server, subEvent("customer.subscription.created", owner.id, { id: "sub_o", customer: "cus_o" }));
    const r = await owner.client.post("/api/billing/checkout", {});
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, "already_plus");
  });

  test("the manage page needs a Stripe customer, and is opened for that customer", async () => {
    const nobody = await signUp(server, "nobody@example.se");
    assert.equal((await nobody.client.post("/api/billing/portal", {})).status, 404);
    const r = await owner.client.post("/api/billing/portal", {});
    assert.equal(r.status, 200);
    assert.equal(r.json.url, "https://billing.stripe.test/p/abc");
    assert.equal(stripe.calls.filter((c) => c.path === "/v1/billing_portal/sessions").pop().form.customer, "cus_o");
  });

  describe("a refund ends the plan", () => {
    const refundEvent = (customer, extra = {}) => ({
      id: `evt_${++evCounter}`, type: "charge.refunded",
      data: { object: { id: "ch_1", customer, amount: 9900, amount_refunded: 9900, refunded: true, created: Math.floor(Date.now() / 1000), ...extra } },
    });
    const withPlus = async (email, sub, customer) => {
      const u = await signUp(server, email);
      await sendEvent(server, subEvent("customer.subscription.created", u.id, { id: sub, customer }));
      assert.equal((await u.client.get("/api/billing/status")).json.plus, true, "setup: Plus is on");
      return u;
    };
    const cancelled = (sub) => stripe.calls.some((c) => c.method === "DELETE" && c.path === `/v1/subscriptions/${sub}`);
    const isPlus = async (u) => (await u.client.get("/api/billing/status")).json.plus;

    test("a full refund cancels the subscription at Stripe and ends Plus at once", async () => {
      const u = await withPlus("refund-full@example.se", "sub_rf", "cus_rf");
      assert.equal((await sendEvent(server, refundEvent("cus_rf"))).status, 200);
      assert.equal(cancelled("sub_rf"), true);
      assert.equal(await isPlus(u), false);
      assert.equal((await u.client.get("/api/usage")).json.limit, 1000);
    });

    test("a refund counted by amount (no refunded flag) is a full refund too", async () => {
      const u = await withPlus("refund-amount@example.se", "sub_ra", "cus_ra");
      await sendEvent(server, refundEvent("cus_ra", { refunded: false }));
      assert.equal(await isPlus(u), false);
    });

    test("a refund from before the current plan began (arriving late) does not cancel it", async () => {
      const u = await signUp(server, "refund-late@example.se");
      await sendEvent(server, { ...subEvent("customer.subscription.created", u.id, { id: "sub_rn", customer: "cus_rn" }), created: 1_800_030_000 });
      assert.equal(await isPlus(u), true, "setup: the new plan is on");
      // The old plan's refund, made earlier than the new subscription but delivered after it.
      assert.equal((await sendEvent(server, { ...refundEvent("cus_rn"), created: 1_800_029_000 })).status, 200);
      assert.equal(cancelled("sub_rn"), false, "nothing was sent to Stripe");
      assert.equal(await isPlus(u), true);
    });

    test("a refund made after the plan's newest event still cancels it", async () => {
      const u = await signUp(server, "refund-after@example.se");
      await sendEvent(server, { ...subEvent("customer.subscription.created", u.id, { id: "sub_rf2", customer: "cus_rf2" }), created: 1_800_040_000 });
      assert.equal((await sendEvent(server, { ...refundEvent("cus_rf2"), created: 1_800_040_500 })).status, 200);
      assert.equal(cancelled("sub_rf2"), true);
      assert.equal(await isPlus(u), false);
    });

    test("a partial refund leaves the plan alone", async () => {
      const u = await withPlus("refund-part@example.se", "sub_rp", "cus_rp");
      assert.equal((await sendEvent(server, refundEvent("cus_rp", { refunded: false, amount_refunded: 3000 }))).status, 200);
      assert.equal(cancelled("sub_rp"), false);
      assert.equal(await isPlus(u), true);
    });

    test("refunding an old payment, after later months were paid, leaves the plan alone", async () => {
      const u = await withPlus("refund-old@example.se", "sub_ro", "cus_ro");
      await sendEvent(server, refundEvent("cus_ro", { created: Math.floor(Date.now() / 1000) - 60 * 86400 }));
      assert.equal(cancelled("sub_ro"), false);
      assert.equal(await isPlus(u), true);
    });

    test("if Stripe can't cancel, the webhook fails so Stripe resends it - and the resend then succeeds", async () => {
      const u = await withPlus("refund-retry@example.se", "sub_rr", "cus_rr");
      const ev = refundEvent("cus_rr");
      stripe.deleteStatus = 500;
      assert.equal((await sendEvent(server, ev)).status, 500);
      assert.equal(await isPlus(u), true, "not recorded as handled: the plan is still on");
      stripe.deleteStatus = 200;
      assert.equal((await sendEvent(server, ev)).status, 200, "the same event, resent");
      assert.equal(await isPlus(u), false);
    });

    test("a subscription Stripe already cancelled is fine", async () => {
      const u = await withPlus("refund-gone@example.se", "sub_rg", "cus_rg");
      stripe.deleteStatus = 400;
      stripe.deleteMessage = "A canceled subscription can only update its cancellation_details.";
      assert.equal((await sendEvent(server, refundEvent("cus_rg"))).status, 200);
      assert.equal(await isPlus(u), false);
      stripe.deleteStatus = 200; stripe.deleteMessage = null;
    });

    test("a refund for someone who isn't on Plus, or isn't ours, changes nothing", async () => {
      const before = stripe.calls.length;
      assert.equal((await sendEvent(server, refundEvent("cus_nobody_at_all"))).status, 200);
      const lapsed = await signUp(server, "refund-lapsed@example.se");
      await sendEvent(server, subEvent("customer.subscription.created", lapsed.id, { id: "sub_rl", customer: "cus_rl", status: "canceled" }));
      assert.equal((await sendEvent(server, refundEvent("cus_rl"))).status, 200);
      assert.equal(stripe.calls.length, before, "nothing was sent to Stripe");
    });
  });

  describe("deleting an account with a subscription", () => {
    test("is refused, and keeps the account, when Stripe cannot cancel it", async () => {
      const u = await signUp(server, "delete-fail@example.se");
      await sendEvent(server, subEvent("customer.subscription.created", u.id, { id: "sub_df", customer: "cus_df" }));
      stripe.deleteStatus = 500;
      const r = await u.client.delete("/api/account", { password: "longenough1" });
      assert.equal(r.status, 502);
      assert.ok(server.db.prepare("SELECT id FROM users WHERE id = ?").get(u.id));
    });

    test("cancels the subscription at Stripe first, then removes everything", async () => {
      const u = await signUp(server, "delete-ok@example.se");
      await sendEvent(server, subEvent("customer.subscription.created", u.id, { id: "sub_do", customer: "cus_do" }));
      stripe.deleteStatus = 200;
      const r = await u.client.delete("/api/account", { password: "longenough1" });
      assert.equal(r.status, 200);
      assert.ok(stripe.calls.some((c) => c.method === "DELETE" && c.path === "/v1/subscriptions/sub_do"));
      assert.equal(server.db.prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE user_id = ?").get(u.id).n, 0);
      assert.equal(server.db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = ?").get(u.id).n, 0);
    });

    test("a subscription Stripe no longer has (404) does not block the delete", async () => {
      const u = await signUp(server, "delete-gone@example.se");
      await sendEvent(server, subEvent("customer.subscription.created", u.id, { id: "sub_dg", customer: "cus_dg" }));
      stripe.deleteStatus = 404;
      assert.equal((await u.client.delete("/api/account", { password: "longenough1" })).status, 200);
    });
  });
});

describe("with a live key everyone can check out", () => {
  let server, stripe, user;
  before(async () => {
    stripe = await startFakeStripe();
    server = await startServer({
      ANTHROPIC_API_KEY: "dummy",
      STRIPE_SECRET_KEY: "sk_live_abc", STRIPE_PRICE_ID: "price_live", STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_API_BASE: stripe.url,
    });
    user = await signUp(server, "anyone@example.se");
  });
  after(async () => { await server.stop(); await stripe.stop(); });

  test("a normal account may start a checkout", async () => {
    assert.equal((await user.client.get("/api/billing/status")).json.canCheckout, true);
    assert.equal((await user.client.post("/api/billing/checkout", {})).status, 200);
  });

  test("a Stripe outage is a 502 with a plain message, never Stripe's own error text", async () => {
    await stripe.stop();
    const r = await user.client.post("/api/billing/checkout", {});
    assert.equal(r.status, 502);
    assert.equal(r.json.error.code, "billing_unavailable");
    stripe.stop = async () => {};   // already closed; keep the after() hook happy
  });
});

describe("a second checkout while the first payment is still going through", () => {
  let server, stripe;
  before(async () => {
    stripe = await startFakeStripe();
    server = await startServer({
      ANTHROPIC_API_KEY: "dummy",
      STRIPE_SECRET_KEY: "sk_live_abc", STRIPE_PRICE_ID: "price_live", STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_API_BASE: stripe.url,
    });
  });
  after(async () => { await server.stop(); await stripe.stop(); });

  const created = () => stripe.sessionsCreated.length;
  const completed = (userId, sessionId, sub, customer) => ({
    id: `evt_${++evCounter}`, type: "checkout.session.completed",
    data: { object: { id: sessionId, mode: "subscription", client_reference_id: userId, customer, subscription: sub } },
  });

  test("Stripe says the last session is paid but the webhook hasn't come: refused, and no second session is made", async () => {
    const u = await signUp(server, "pay-twice@example.se");
    assert.equal((await u.client.post("/api/billing/checkout", {})).status, 200);
    const first = stripe.sessionsCreated.at(-1);
    stripe.sessionStatus[first] = "complete";
    const before = created();
    const r = await u.client.post("/api/billing/checkout", {});
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, "payment_processing");
    assert.equal(created(), before, "no second Checkout was opened");
  });

  test("a session that was only opened and abandoned is expired, and a new one starts", async () => {
    const u = await signUp(server, "abandoned@example.se");
    await u.client.post("/api/billing/checkout", {});
    const first = stripe.sessionsCreated.at(-1);
    const r = await u.client.post("/api/billing/checkout", {});
    assert.equal(r.status, 200);
    assert.equal(stripe.sessionStatus[first], "expired", "the old one can't be paid later from another tab");
    assert.ok(stripe.calls.some((c) => c.method === "POST" && c.path === `/v1/checkout/sessions/${first}/expire`));
    assert.notEqual(stripe.sessionsCreated.at(-1), first);
  });

  test("if Stripe can't be asked, it is a 502 and nothing is opened (no guessing)", async () => {
    const u = await signUp(server, "lookup-fails@example.se");
    await u.client.post("/api/billing/checkout", {});
    const before = created();
    stripe.sessionLookupStatus = 500;
    const r = await u.client.post("/api/billing/checkout", {});
    stripe.sessionLookupStatus = 200;
    assert.equal(r.status, 502);
    assert.equal(created(), before);
  });

  test("once 'checkout completed' has linked the subscription but its status hasn't followed, a new checkout is refused; then Plus is on", async () => {
    const u = await signUp(server, "linked@example.se");
    await u.client.post("/api/billing/checkout", {});
    const sid = stripe.sessionsCreated.at(-1);
    await sendEvent(server, completed(u.id, sid, "sub_lk", "cus_lk"));
    const before = created();
    const r = await u.client.post("/api/billing/checkout", {});
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, "payment_processing");
    assert.equal(created(), before);
    await sendEvent(server, subEvent("customer.subscription.created", u.id, { id: "sub_lk", customer: "cus_lk" }));
    assert.equal((await u.client.post("/api/billing/checkout", {})).json.error.code, "already_plus");
  });

  test("someone whose plan ended can subscribe again: the finished checkout is not remembered against them", async () => {
    const u = await signUp(server, "returning@example.se");
    await u.client.post("/api/billing/checkout", {});
    const sid = stripe.sessionsCreated.at(-1);
    stripe.sessionStatus[sid] = "complete";
    await sendEvent(server, completed(u.id, sid, "sub_rt", "cus_rt"));
    await sendEvent(server, subEvent("customer.subscription.created", u.id, { id: "sub_rt", customer: "cus_rt" }));
    await sendEvent(server, subEvent("customer.subscription.deleted", u.id, { id: "sub_rt", customer: "cus_rt", status: "canceled" }));
    const r = await u.client.post("/api/billing/checkout", {});
    assert.equal(r.status, 200, "a returning customer is not blocked by their old, paid checkout");
  });

  test("starting a checkout does not make an account look like it has a plan", async () => {
    const u = await signUp(server, "just-looking@example.se");
    await u.client.post("/api/billing/checkout", {});
    const st = (await u.client.get("/api/billing/status")).json;
    assert.equal(st.plus, false);
    assert.equal(st.hasCustomer, false);
  });
});

describe("deleting an account while Stripe is switched off", () => {
  let server;
  before(async () => { server = await startServer({ ANTHROPIC_API_KEY: "dummy" }); });   // no Stripe secrets at all
  after(async () => { await server.stop(); });

  const giveSubscription = (userId, status, { cancelAtPeriodEnd = 0 } = {}) => server.db.prepare(
    `INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, cancel_at_period_end, updated_at)
     VALUES (?, 'cus_off', 'sub_off', ?, ?, ?, ?)`
  ).run(userId, status, Date.now() + 20 * 86400_000, cancelAtPeriodEnd, Date.now());
  const exists = (id) => server.db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = ?").get(id).n === 1;

  test("a plan that is still running is not deleted with it: nothing could stop Stripe charging for it", async () => {
    const u = await signUp(server, "off-active@example.se");
    giveSubscription(u.id, "active");
    const r = await u.client.delete("/api/account", { password: "longenough1" });
    assert.equal(r.status, 503);
    assert.equal(r.json.error.code, "billing_unavailable");
    assert.ok(exists(u.id), "the account is still there");
    assert.equal(server.db.prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE user_id = ?").get(u.id).n, 1);
  });

  test("a plan already set to end by itself, or one that has ended, doesn't hold the deletion up", async () => {
    const ending = await signUp(server, "off-ending@example.se");
    giveSubscription(ending.id, "active", { cancelAtPeriodEnd: 1 });
    assert.equal((await ending.client.delete("/api/account", { password: "longenough1" })).status, 200);
    const ended = await signUp(server, "off-ended@example.se");
    giveSubscription(ended.id, "canceled");
    assert.equal((await ended.client.delete("/api/account", { password: "longenough1" })).status, 200);
    assert.ok(!exists(ending.id) && !exists(ended.id));
  });

  test("an account that never had a plan is deleted as usual", async () => {
    const u = await signUp(server, "off-never@example.se");
    assert.equal((await u.client.delete("/api/account", { password: "longenough1" })).status, 200);
  });
});

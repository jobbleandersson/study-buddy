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
  const fake = { calls, deleteStatus: 200 };
  const srv = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => { raw += d; });
    req.on("end", () => {
      const form = Object.fromEntries(new URLSearchParams(raw));
      calls.push({ method: req.method, path: req.url, form, auth: req.headers.authorization });
      res.setHeader("content-type", "application/json");
      if (req.method === "DELETE") { res.statusCode = fake.deleteStatus; return res.end(JSON.stringify({ id: "sub_x", status: "canceled" })); }
      if (req.url === "/v1/checkout/sessions") return res.end(JSON.stringify({ url: "https://checkout.stripe.test/c/abc" }));
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

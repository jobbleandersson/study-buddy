import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, startFakeResend, makeClient } from "./harness.mjs";

// The AI limits around the proxy, from the everyday one out (usage.js): an unconfirmed address gets a small
// trial, unconfirmed accounts together share a daily pool, each account has a daily limit, and the whole
// server has an emergency brake that mails the owner. Email is on in these suites (a fake Resend), so a new
// email sign-up starts unconfirmed, as it does in production.

const PERIOD = new Date().toISOString().slice(0, 7);   // "YYYY-MM" (UTC), same as usage.js currentPeriod()
const BODY = { model: "claude-haiku-4-5", max_tokens: 5, messages: [{ role: "user", content: "hi" }] };
const OWNER = "owner-alerts@example.se";
const unique = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.se`;

async function signUp(server, email = unique("student")) {
  const client = makeClient(server.baseUrl);
  const r = await client.post("/api/auth/signup", { email, password: "longenough1", consent: true });
  assert.equal(r.status, 200, `signup ${email}`);
  const id = server.db.prepare("SELECT id FROM users WHERE email = ?").get(email).id;
  return { client, id, email };
}
const spendKr = (server, userId, kr) => server.db.prepare(
  "INSERT INTO ai_usage (user_id, period, input_tokens, output_tokens, request_count, cost_micro, updated_at) VALUES (?, ?, 1, 1, 1, ?, ?)"
).run(userId, PERIOD, Math.round((kr / 10) * 1_000_000), Date.now());   // AI_KR_PER_USD is 10
const confirm = (server, userId) => server.db.prepare("UPDATE users SET email_verified_at = ? WHERE id = ?").run(Date.now(), userId);
const waitFor = async (fn, ms = 2000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 25)); } return false; };

describe("an unconfirmed address gets a small trial, and confirming lifts it", () => {
  let server, fake;
  before(async () => {
    fake = await startFakeResend();
    server = await startServer({ ANTHROPIC_API_KEY: "dummy-test-key", RESEND_API_KEY: "test-key", RESEND_API_URL: fake.url });
  });
  after(async () => { await server.stop(); await fake.stop(); });

  test("/api/usage shows the trial limit and says confirming raises it", async () => {
    const u = await signUp(server);
    const r = await u.client.get("/api/usage");
    assert.equal(r.status, 200);
    assert.equal(r.json.limit, 0.25);
    assert.equal(r.json.needsVerify, true);
  });

  test("past the trial the proxy answers 402 verify_email, not the monthly quota", async () => {
    const u = await signUp(server);
    spendKr(server, u.id, 0.3);
    const r = await u.client.post("/api/messages", BODY);
    assert.equal(r.status, 402);
    assert.equal(r.json.error.code, "verify_email");
    assert.equal(r.json.needsVerify, true);
    assert.equal(r.json.limit, 0.25);
  });

  test("a confirmed account has the full free month, the spend so far still counted", async () => {
    const u = await signUp(server);
    spendKr(server, u.id, 0.3);
    confirm(server, u.id);
    const usage = await u.client.get("/api/usage");
    assert.equal(usage.json.limit, 2);
    assert.equal(usage.json.needsVerify, false);
    assert.ok(usage.json.used >= 0.3);
    const r = await u.client.post("/api/messages", BODY);
    assert.notEqual(r.status, 402, "0.3 of 2 kr: past the budget check (whatever upstream then answers)");
  });

  test("a confirmed account over its month still gets quota_exceeded", async () => {
    const u = await signUp(server);
    confirm(server, u.id);
    spendKr(server, u.id, 3);
    const r = await u.client.post("/api/messages", BODY);
    assert.equal(r.status, 402);
    assert.equal(r.json.error.code, "quota_exceeded");
    assert.equal(r.json.needsVerify, undefined);
  });
});

describe("unconfirmed accounts share one daily pool; confirmed ones are not touched by it", () => {
  let server, fake;
  before(async () => {
    fake = await startFakeResend();
    server = await startServer({
      ANTHROPIC_API_KEY: "dummy-test-key", RESEND_API_KEY: "test-key", RESEND_API_URL: fake.url, ALERT_EMAIL: OWNER,
      AI_UNVERIFIED_DAILY_USD: "0.000001",   // one micro-dollar: any request is over it
    });
  });
  after(async () => { await server.stop(); await fake.stop(); });

  test("an unconfirmed account is turned away with 429 unverified_pool, and the owner hears once", async () => {
    const a = await signUp(server), b = await signUp(server);
    for (const u of [a, b]) {
      const r = await u.client.post("/api/messages", BODY);
      assert.equal(r.status, 429);
      assert.equal(r.json.error.code, "unverified_pool");
    }
    assert.ok(await waitFor(() => fake.mailsTo(OWNER).some((m) => /AI-pott/.test(m.subject))), "the owner is mailed");
    assert.equal(fake.mailsTo(OWNER).filter((m) => /AI-pott/.test(m.subject)).length, 1, "once a day, not per request");
    const mail = fake.mailsTo(OWNER)[0];
    assert.equal(mail.html.includes(a.email) || mail.html.includes(b.email), false, "no student address in the owner's mail");
  });

  test("a confirmed account gets past the pool", async () => {
    const u = await signUp(server);
    confirm(server, u.id);
    const r = await u.client.post("/api/messages", BODY);
    assert.notEqual(r.json?.error?.code, "unverified_pool");
  });
});

describe("each account has a daily limit of its own", () => {
  let server;
  before(async () => {
    server = await startServer({ ANTHROPIC_API_KEY: "dummy-test-key", AI_USER_DAILY_KR: "0.00001" });   // far below one request
  });
  after(async () => { await server.stop(); });

  test("over it the proxy answers 429 user_daily_cap", async () => {
    const u = await signUp(server);
    const r = await u.client.post("/api/messages", BODY);
    assert.equal(r.status, 429);
    assert.equal(r.json.error.code, "user_daily_cap");
    assert.ok(r.json.resetsAt > Date.now());
  });
});

describe("the server-wide emergency brake", () => {
  let server, fake;
  before(async () => {
    fake = await startFakeResend();
    server = await startServer({
      ANTHROPIC_API_KEY: "dummy-test-key", RESEND_API_KEY: "test-key", RESEND_API_URL: fake.url, ALERT_EMAIL: OWNER,
      AI_DAILY_SPEND_CAP_USD: "0.000001",
    });
  });
  after(async () => { await server.stop(); await fake.stop(); });

  test("past it AI is paused for everyone (503 daily_cap) and the owner is mailed once", async () => {
    const a = await signUp(server), b = await signUp(server);
    for (const u of [a, b]) {
      const r = await u.client.post("/api/messages", BODY);
      assert.equal(r.status, 503);
      assert.equal(r.json.error.code, "daily_cap");
    }
    assert.ok(await waitFor(() => fake.mailsTo(OWNER).some((m) => /pausat för alla/.test(m.subject))), "the owner is mailed");
    assert.equal(fake.mailsTo(OWNER).filter((m) => /pausat för alla/.test(m.subject)).length, 1);
  });
});

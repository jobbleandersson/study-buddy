import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient } from "./harness.mjs";

// The owner and testers can be exempted from the per-account monthly token ceiling
// (AI_BUDGET_EXEMPT_EMAILS); everyone else stays metered. Nobody is exempt by default.

const PERIOD = new Date().toISOString().slice(0, 7);   // "YYYY-MM" (UTC), same as usage.js currentPeriod()
const BODY = { model: "claude-haiku-4-5", max_tokens: 5, messages: [{ role: "user", content: "hi" }] };

async function signUp(server, email) {
  const client = makeClient(server.baseUrl);
  const r = await client.post("/api/auth/signup", { email, password: "longenough1", consent: true });
  assert.equal(r.status, 200, `signup ${email}`);
  const id = server.db.prepare("SELECT id FROM users WHERE email = ?").get(email).id;
  return { client, id };
}

function spendOver(server, userId) {
  server.db.prepare(
    "INSERT INTO ai_usage (user_id, period, input_tokens, output_tokens, request_count, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(userId, PERIOD, 5000, 5000, 3, Date.now());   // 10,000 tokens against a 1,000 ceiling
}

describe("per-account monthly budget and the exempt list", () => {
  let server, owner, tester, regular;
  before(async () => {
    server = await startServer({
      ANTHROPIC_API_KEY: "dummy-test-key",
      AI_MONTHLY_TOKEN_BUDGET: "1000",
      AI_BUDGET_EXEMPT_EMAILS: " Owner@Example.se , tester@example.se ",   // case and spaces must not matter
    });
    owner = await signUp(server, "owner@example.se");
    tester = await signUp(server, "tester@example.se");
    regular = await signUp(server, "regular@example.se");
    for (const u of [owner, tester, regular]) spendOver(server, u.id);
  });
  after(async () => { await server.stop(); });

  test("a normal account over its ceiling is turned away with 402 quota_exceeded", async () => {
    const r = await regular.client.post("/api/messages", BODY);
    assert.equal(r.status, 402);
    assert.equal(r.json.error.code, "quota_exceeded");
    assert.equal(r.json.limit, 1000);
  });

  test("an exempt account is not stopped by the monthly ceiling (whatever upstream then answers)", async () => {
    for (const u of [owner, tester]) {
      const r = await u.client.post("/api/messages", BODY);
      assert.notEqual(r.status, 402, "exempt accounts must get past the budget check");
      assert.notEqual(r.json?.error?.code, "quota_exceeded");
    }
  });

  test("/api/usage reports the ceiling for a normal account and none for an exempt one", async () => {
    const normal = await regular.client.get("/api/usage");
    assert.equal(normal.status, 200);
    assert.equal(normal.json.metered, true);
    assert.ok(normal.json.used > normal.json.limit);
    const exempt = await owner.client.get("/api/usage");
    assert.equal(exempt.json.metered, false);
  });
});

describe("nobody is exempt unless listed", () => {
  let server, user;
  before(async () => {
    server = await startServer({ ANTHROPIC_API_KEY: "dummy-test-key", AI_MONTHLY_TOKEN_BUDGET: "1000" });   // no AI_BUDGET_EXEMPT_EMAILS
    user = await signUp(server, "someone@example.se");
    spendOver(server, user.id);
  });
  after(async () => { await server.stop(); });

  test("with the list unset every account is metered", async () => {
    const r = await user.client.post("/api/messages", BODY);
    assert.equal(r.status, 402);
    assert.equal((await user.client.get("/api/usage")).json.metered, true);
  });
});

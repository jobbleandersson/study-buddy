import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, startFakeResend, makeClient, hashToken } from "./harness.mjs";

const uniqueEmail = () => `verify-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

describe("POST /api/auth/verify-email", () => {
  let server, client, fake;
  before(async () => {
    fake = await startFakeResend();
    server = await startServer({ RESEND_API_KEY: "dummy-test-key", RESEND_API_URL: fake.url });
    client = makeClient(server.baseUrl);
  });
  after(async () => { await server.stop(); await fake.stop(); });

  async function signupAndGetToken() {
    const email = uniqueEmail();
    await client.post("/api/auth/signup", { email, password: "correctpw1", consent: true });
    // From the mailed link, as a person would: the database holds only its hash (src/tokens.js).
    return { email, token: await fake.waitToken(email) };
  }

  test("a missing token is rejected", async () => {
    const { status, json } = await client.post("/api/auth/verify-email", {});
    assert.equal(status, 400);
    assert.equal(json.error.code, "bad_token");
  });

  test("an unknown token is rejected", async () => {
    const { status, json } = await client.post("/api/auth/verify-email", { token: "not-a-real-token" });
    assert.equal(status, 400);
    assert.equal(json.error.code, "bad_token");
  });

  test("a valid token verifies the account and returns its email", async () => {
    const { email, token } = await signupAndGetToken();
    const { status, json } = await client.post("/api/auth/verify-email", { token });
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.email, email);

    const row = server.db.prepare("SELECT email_verified_at FROM users WHERE email = ?").get(email);
    assert.ok(row.email_verified_at > 0);
  });

  test("the same token cannot be used twice", async () => {
    const { token } = await signupAndGetToken();
    const first = await client.post("/api/auth/verify-email", { token });
    assert.equal(first.status, 200);
    const second = await client.post("/api/auth/verify-email", { token });
    assert.equal(second.status, 400);
    assert.equal(second.json.error.code, "bad_token");
  });

  test("an expired token is rejected", async () => {
    const { token } = await signupAndGetToken();
    server.db.prepare("UPDATE email_verify_tokens SET expires_at = ? WHERE token = ?").run(Date.now() - 1000, hashToken(token));
    const { status, json } = await client.post("/api/auth/verify-email", { token });
    assert.equal(status, 400);
    assert.equal(json.error.code, "bad_token");
  });

  test("two simultaneous requests for the same token: exactly one succeeds", async () => {
    const { token } = await signupAndGetToken();
    const [a, b] = await Promise.all([
      client.post("/api/auth/verify-email", { token }),
      client.post("/api/auth/verify-email", { token }),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [200, 400]);
  });
});

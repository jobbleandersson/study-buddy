// The main suites all disable every attemptLimit via env (see harness.mjs) so
// they can hammer the server without tripping unrelated 429s. This file is
// the one place that deliberately turns limits back on, tight, to exercise
// the 429 path itself.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient } from "./harness.mjs";

const uniqueEmail = () => `ratelimit-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

describe("signup rate limiting", () => {
  let server, client;
  before(async () => {
    server = await startServer({ SIGNUPS_PER_HOUR_PER_IP: "3" });
    client = makeClient(server.baseUrl);
  });
  after(async () => { await server.stop(); });

  test("every signup attempt counts, success or not, and the 4th is blocked with Retry-After", async () => {
    for (let i = 0; i < 3; i++) {
      const { status } = await client.post("/api/auth/signup", { email: uniqueEmail(), password: "longenough", consent: true });
      assert.equal(status, 200);
    }
    const { status, json, res } = await client.post("/api/auth/signup", { email: uniqueEmail(), password: "longenough", consent: true });
    assert.equal(status, 429);
    assert.equal(json.error.code, "rate_limited");
    assert.ok(res.headers.get("retry-after"));
  });
});

describe("login failure rate limiting: per account", () => {
  let server, client;
  before(async () => {
    server = await startServer({ LOGIN_FAILS_PER_15MIN_PER_ACCOUNT: "3", LOGIN_FAILS_PER_15MIN_PER_IP: "0" });
    client = makeClient(server.baseUrl);
  });
  after(async () => { await server.stop(); });

  test("only wrong passwords count - a successful login never trips the limit", async () => {
    const email = uniqueEmail();
    await client.post("/api/auth/signup", { email, password: "correctpw1", consent: true });
    client.clearCookie();
    for (let i = 0; i < 5; i++) {
      const { status } = await client.post("/api/auth/login", { email, password: "correctpw1" });
      assert.equal(status, 200);
    }
  });

  test("the 4th wrong password in a row for one account is blocked, a different account is unaffected", async () => {
    const email = uniqueEmail();
    await client.post("/api/auth/signup", { email, password: "correctpw1", consent: true });
    client.clearCookie();

    for (let i = 0; i < 3; i++) {
      const { status } = await client.post("/api/auth/login", { email, password: "wrongpassword" });
      assert.equal(status, 401);
    }
    const blocked = await client.post("/api/auth/login", { email, password: "wrongpassword" });
    assert.equal(blocked.status, 429);

    // A second, unrelated account on the same IP must not be affected - the
    // tight limit here is per-account, only the generous per-IP one (disabled
    // above) would have caught this.
    const otherEmail = uniqueEmail();
    await client.post("/api/auth/signup", { email: otherEmail, password: "correctpw1", consent: true });
    client.clearCookie();
    const other = await client.post("/api/auth/login", { email: otherEmail, password: "wrongpassword" });
    assert.equal(other.status, 401);
  });
});

describe("Google sign-in rate limiting: 401s count", () => {
  let server, client;
  before(async () => {
    server = await startServer({
      GOOGLE_CLIENT_ID: "fake-client-id.apps.googleusercontent.com",
      GOOGLE_SIGNIN_FAILS_PER_MIN_PER_IP: "3",
    });
    client = makeClient(server.baseUrl);
  });
  after(async () => { await server.stop(); });

  test("a syntactically invalid credential fails fast with 401 (no Google network call), and 3/min trips the 4th", async () => {
    for (let i = 0; i < 3; i++) {
      const { status, json } = await client.post("/api/auth/google", { credential: "not-a-jwt", consent: true });
      assert.equal(status, 401);
      assert.equal(json.error.code, "google_invalid");
    }
    const blocked = await client.post("/api/auth/google", { credential: "not-a-jwt", consent: true });
    assert.equal(blocked.status, 429);
  });
});

describe("Google sign-in rate limiting: a non-401/403 response never counts", () => {
  let server, client;
  before(async () => {
    // No GOOGLE_CLIENT_ID at all - every call short-circuits to 501 before
    // ever looking at the credential, which is a deterministic, network-free
    // way to see that a status outside [401, 403] never fills the bucket.
    server = await startServer({ GOOGLE_SIGNIN_FAILS_PER_MIN_PER_IP: "3" });
    client = makeClient(server.baseUrl);
  });
  after(async () => { await server.stop(); });

  test("many 501s in a row never trip the limiter", async () => {
    for (let i = 0; i < 10; i++) {
      const { status, json } = await client.post("/api/auth/google", { credential: "anything", consent: true });
      assert.equal(status, 501);
      assert.equal(json.error.code, "google_not_configured");
    }
  });
});

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient } from "./harness.mjs";

const uniqueEmail = () => `login-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

describe("POST /api/auth/login", () => {
  let server, client;
  before(async () => { server = await startServer({ RESEND_API_KEY: "dummy-test-key" }); client = makeClient(server.baseUrl); });
  after(async () => { await server.stop(); });

  test("unknown email is rejected the same way as a wrong password", async () => {
    const { status, json } = await client.post("/api/auth/login", { email: uniqueEmail(), password: "whatever1" });
    assert.equal(status, 401);
    assert.match(json.error.message, /wrong/i);
  });

  test("a correct password signs the account in and sets a session cookie", async () => {
    const email = uniqueEmail();
    await client.post("/api/auth/signup", { email, password: "correctpw1", consent: true });
    client.clearCookie();

    const { status, json, res } = await client.post("/api/auth/login", { email, password: "correctpw1" });
    assert.equal(status, 200);
    assert.equal(json.email, email);
    assert.ok(res.headers.getSetCookie().length > 0);
  });

  test("a wrong password for a real account is rejected", async () => {
    const email = uniqueEmail();
    await client.post("/api/auth/signup", { email, password: "correctpw1", consent: true });
    client.clearCookie();

    const { status } = await client.post("/api/auth/login", { email, password: "wrongpassword" });
    assert.equal(status, 401);
  });

  test("an unverified account can still log in, and reports emailVerified:false", async () => {
    const email = uniqueEmail();
    await client.post("/api/auth/signup", { email, password: "correctpw1", consent: true });
    client.clearCookie();

    const { status, json } = await client.post("/api/auth/login", { email, password: "correctpw1" });
    assert.equal(status, 200);
    assert.equal(json.emailVerified, false);
  });
});

describe("GET /api/auth/me", () => {
  let server, client;
  before(async () => { server = await startServer(); client = makeClient(server.baseUrl); });
  after(async () => { await server.stop(); });

  test("a signed-out visitor gets a plain 200 authed:false, not a 401", async () => {
    const { status, json } = await client.get("/api/auth/me");
    assert.equal(status, 200);
    assert.equal(json.authed, false);
  });

  test("a signed-in session reports its own email", async () => {
    const email = uniqueEmail();
    await client.post("/api/auth/signup", { email, password: "correctpw1", consent: true });
    const { status, json } = await client.get("/api/auth/me");
    assert.equal(status, 200);
    assert.equal(json.authed, true);
    assert.equal(json.email, email);
  });
});

describe("POST /api/auth/logout", () => {
  let server, client;
  before(async () => { server = await startServer(); client = makeClient(server.baseUrl); });
  after(async () => { await server.stop(); });

  test("logging out invalidates the session, so /me reads signed-out afterwards", async () => {
    const email = uniqueEmail();
    await client.post("/api/auth/signup", { email, password: "correctpw1", consent: true });
    const before1 = await client.get("/api/auth/me");
    assert.equal(before1.json.authed, true);

    const out = await client.post("/api/auth/logout");
    assert.equal(out.status, 200);

    const after1 = await client.get("/api/auth/me");
    assert.equal(after1.json.authed, false);
  });
});

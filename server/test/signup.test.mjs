import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient } from "./harness.mjs";

const uniqueEmail = () => `signup-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

describe("POST /api/auth/signup - validation", () => {
  let server, client;
  before(async () => { server = await startServer({ RESEND_API_KEY: "" }); client = makeClient(server.baseUrl); });
  after(async () => { await server.stop(); });

  test("rejects signup without accepting the terms", async () => {
    const { status, json } = await client.post("/api/auth/signup", {
      email: uniqueEmail(), password: "longenough", consent: false,
    });
    assert.equal(status, 400);
    assert.equal(json.error.code, "consent_required");
  });

  test("rejects a password shorter than 8 characters", async () => {
    const { status } = await client.post("/api/auth/signup", {
      email: uniqueEmail(), password: "short1", consent: true,
    });
    assert.equal(status, 400);
  });

  test("rejects a password longer than 200 characters", async () => {
    const { status } = await client.post("/api/auth/signup", {
      email: uniqueEmail(), password: "x".repeat(201), consent: true,
    });
    assert.equal(status, 400);
  });

  test("rejects an email with no @", async () => {
    const { status } = await client.post("/api/auth/signup", {
      email: "not-an-email", password: "longenough", consent: true,
    });
    assert.equal(status, 400);
  });
});

describe("POST /api/auth/signup - success and duplicates, email OFF", () => {
  let server, client;
  before(async () => { server = await startServer({ RESEND_API_KEY: "" }); client = makeClient(server.baseUrl); });
  after(async () => { await server.stop(); });

  test("a valid signup creates the account, signs it in, and needs no verification when email is off", async () => {
    const email = uniqueEmail();
    const { status, json, res } = await client.post("/api/auth/signup", { email, password: "longenough", consent: true });
    assert.equal(status, 200);
    assert.equal(json.email, email);
    assert.equal(json.emailVerified, true);
    assert.ok(res.headers.getSetCookie().length > 0, "expected a session cookie to be set");

    const row = server.db.prepare("SELECT email_verify_required FROM users WHERE email = ?").get(email);
    assert.equal(row.email_verify_required, null);
    const tokenRow = server.db.prepare("SELECT * FROM email_verify_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?)").get(email);
    assert.equal(tokenRow, undefined, "no verify token should be issued when email is off");
  });

  test("signing up twice with the same email is rejected as a duplicate", async () => {
    const email = uniqueEmail();
    const first = await client.post("/api/auth/signup", { email, password: "longenough", consent: true });
    assert.equal(first.status, 200);
    const second = await client.post("/api/auth/signup", { email, password: "otherpassword", consent: true });
    assert.equal(second.status, 409);
  });

  test("email is trimmed and lowercased before dedup", async () => {
    const base = uniqueEmail();
    const first = await client.post("/api/auth/signup", { email: base, password: "longenough", consent: true });
    assert.equal(first.status, 200);
    const upper = `  ${base.toUpperCase()}  `;
    const second = await client.post("/api/auth/signup", { email: upper, password: "longenough", consent: true });
    assert.equal(second.status, 409);
  });
});

describe("POST /api/auth/signup - email ON (dummy key)", () => {
  let server, client;
  before(async () => { server = await startServer({ RESEND_API_KEY: "dummy-test-key" }); client = makeClient(server.baseUrl); });
  after(async () => { await server.stop(); });

  test("a valid signup reports emailVerified:false and stores a usable verify token", async () => {
    const email = uniqueEmail();
    const { status, json } = await client.post("/api/auth/signup", { email, password: "longenough", consent: true });
    assert.equal(status, 200);
    assert.equal(json.emailVerified, false);

    const row = server.db.prepare("SELECT id, email_verify_required FROM users WHERE email = ?").get(email);
    assert.equal(row.email_verify_required, 1);
    const tokenRow = server.db.prepare("SELECT * FROM email_verify_tokens WHERE user_id = ?").get(row.id);
    assert.ok(tokenRow, "a verify token should have been issued");
    assert.equal(tokenRow.used_at, null);
    assert.ok(tokenRow.expires_at > Date.now());
  });
});

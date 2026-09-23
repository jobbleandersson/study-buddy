import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { startServer, makeClient } from "./harness.mjs";

const uniqueEmail = () => `forgot-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

function resetTokenCount(db, email) {
  return db.prepare(
    "SELECT COUNT(*) AS n FROM password_reset_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?)"
  ).get(email).n;
}

describe("POST /api/auth/forgot-password - email ON", () => {
  let server, client;
  before(async () => { server = await startServer({ RESEND_API_KEY: "dummy-test-key" }); client = makeClient(server.baseUrl); });
  after(async () => { await server.stop(); });

  test("an unknown email gets the same {ok:true} as a real one, and issues no token", async () => {
    const email = uniqueEmail();
    const { status, json } = await client.post("/api/auth/forgot-password", { email });
    assert.equal(status, 200);
    assert.deepEqual(json, { ok: true });
    assert.equal(resetTokenCount(server.db, email), 0);
  });

  test("a real, existing account gets {ok:true} and one reset token", async () => {
    const email = uniqueEmail();
    await client.post("/api/auth/signup", { email, password: "correctpw1", consent: true });
    client.clearCookie();

    const { status, json } = await client.post("/api/auth/forgot-password", { email });
    assert.equal(status, 200);
    assert.deepEqual(json, { ok: true });
    assert.equal(resetTokenCount(server.db, email), 1);
  });

  test("a Google-linked account gets {ok:true} but no reset token (it has no password)", async () => {
    // No safe seam exists to drive a real /auth/google signup in tests (it needs a
    // live Google credential) - inserting the row directly exercises exactly what
    // this route branches on: users.google_sub being set.
    const email = uniqueEmail();
    const now = Date.now();
    server.db.prepare(
      "INSERT INTO users (id, email, password_hash, google_sub, created_at, email_verified_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(crypto.randomUUID(), email, "unusable-hash", "google-sub-123", now, now);

    const { status, json } = await client.post("/api/auth/forgot-password", { email });
    assert.equal(status, 200);
    assert.deepEqual(json, { ok: true });
    assert.equal(resetTokenCount(server.db, email), 0);
  });

  test("asking twice in a row does not issue a second token within the cooldown", async () => {
    const email = uniqueEmail();
    await client.post("/api/auth/signup", { email, password: "correctpw1", consent: true });
    client.clearCookie();

    await client.post("/api/auth/forgot-password", { email });
    await client.post("/api/auth/forgot-password", { email });
    assert.equal(resetTokenCount(server.db, email), 1);
  });
});

describe("POST /api/auth/forgot-password - email OFF", () => {
  let server, client;
  before(async () => { server = await startServer({ RESEND_API_KEY: "" }); client = makeClient(server.baseUrl); });
  after(async () => { await server.stop(); });

  test("still answers {ok:true} for a real account, but issues no token at all", async () => {
    const email = uniqueEmail();
    await client.post("/api/auth/signup", { email, password: "correctpw1", consent: true });
    client.clearCookie();

    const { status, json } = await client.post("/api/auth/forgot-password", { email });
    assert.equal(status, 200);
    assert.deepEqual(json, { ok: true });
    assert.equal(resetTokenCount(server.db, email), 0);
  });
});

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { startServer, makeClient } from "./harness.mjs";
import { googleIdentityMatches } from "../src/routes/auth.js";

// googleIdentityMatches is the one check /auth/set-password's security rests on — unit-tested
// directly and exhaustively, the same seam-testing style google.test.mjs uses for
// verifyGoogleIdToken, rather than building Google-JWT-signing-over-HTTP infrastructure (this
// codebase has never had that for any Google-touching route, not even /auth/google itself).
describe("googleIdentityMatches", () => {
  test("matches when the profile's sub equals the stored google_sub", () => {
    assert.equal(googleIdentityMatches({ googleSub: "abc123" }, { sub: "abc123" }), true);
  });
  test("rejects a mismatched sub — a different, valid Google account", () => {
    assert.equal(googleIdentityMatches({ googleSub: "abc123" }, { sub: "someone-elses-sub" }), false);
  });
  test("rejects when the row has no googleSub at all", () => {
    assert.equal(googleIdentityMatches({ googleSub: null }, { sub: "abc123" }), false);
    assert.equal(googleIdentityMatches({}, { sub: "abc123" }), false);
  });
});

const uniqueEmail = () => `setpw-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

describe("POST /api/auth/set-password", () => {
  let server, client;
  before(async () => { server = await startServer({ RESEND_API_KEY: "dummy-test-key" }); client = makeClient(server.baseUrl); });
  after(async () => { await server.stop(); });

  /** A signed-in, Google-linked account with no password yet — the direct-row-insertion pattern
   *  account-delete.test.mjs already uses, since there's no safe seam to drive a real Google
   *  sign-in in tests. */
  function googleOnlyAccount() {
    const email = uniqueEmail();
    const now = Date.now();
    const id = crypto.randomUUID();
    server.db.prepare(
      "INSERT INTO users (id, email, password_hash, google_sub, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(id, email, "unusable-hash", "google-sub-" + id, now);
    server.db.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(crypto.randomUUID(), id, now + 3600_000, now);
    client.cookie = `sb_session=${server.db.prepare("SELECT id FROM sessions WHERE user_id = ?").get(id).id}`;
    return { id, email };
  }

  test("requires a signed-in session", async () => {
    client.clearCookie();
    const { status } = await client.post("/api/auth/set-password", { credential: "whatever", password: "newpassword1" });
    assert.equal(status, 401);
  });

  test("a plain password account (no Google link at all) is rejected", async () => {
    const email = uniqueEmail();
    await client.post("/api/auth/signup", { email, password: "correctpw1", consent: true });
    const { status, json } = await client.post("/api/auth/set-password", { credential: "whatever", password: "newpassword1" });
    assert.equal(status, 400);
    assert.equal(json.error.code, "no_google_account");
  });

  test("a hybrid account (already has a password) is rejected", async () => {
    const email = uniqueEmail();
    const now = Date.now();
    const id = crypto.randomUUID();
    const hash = await bcrypt.hash("correctpw1", 10);
    server.db.prepare(
      "INSERT INTO users (id, email, password_hash, google_sub, password_set_at, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, email, hash, "google-sub-already", now, now);
    server.db.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(crypto.randomUUID(), id, now + 3600_000, now);
    client.cookie = `sb_session=${server.db.prepare("SELECT id FROM sessions WHERE user_id = ?").get(id).id}`;

    const { status, json } = await client.post("/api/auth/set-password", { credential: "whatever", password: "newpassword1" });
    assert.equal(status, 400);
    assert.equal(json.error.code, "password_already_set");
  });

  test("a garbage credential is rejected without touching the database", async () => {
    const { id } = googleOnlyAccount();
    const { status, json } = await client.post("/api/auth/set-password", { credential: "not-a-real-jwt", password: "newpassword1" });
    assert.equal(status, 401);
    assert.equal(json.error.code, "google_invalid");
    const row = server.db.prepare("SELECT password_set_at FROM users WHERE id = ?").get(id);
    assert.equal(row.password_set_at, null);
  });

  test("password length is validated before any Google check", async () => {
    googleOnlyAccount();
    const { status } = await client.post("/api/auth/set-password", { credential: "whatever", password: "short" });
    assert.equal(status, 400);
  });
});

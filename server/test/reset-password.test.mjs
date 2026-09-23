import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { startServer, makeClient } from "./harness.mjs";

const uniqueEmail = () => `reset-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

describe("POST /api/auth/reset-password", () => {
  let server, client;
  before(async () => { server = await startServer({ RESEND_API_KEY: "dummy-test-key" }); client = makeClient(server.baseUrl); });
  after(async () => { await server.stop(); });

  /** Creates a real account via the API, then issues a reset token for it
   *  by inserting the row directly - bypassing the 2-minute forgot-password
   *  cooldown so a test can hand out more than one live token at will. */
  function issueResetToken(userId, { expiresInMs = 60 * 60 * 1000 } = {}) {
    const token = crypto.randomBytes(32).toString("hex");
    const now = Date.now();
    server.db.prepare(
      "INSERT INTO password_reset_tokens (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(crypto.randomUUID(), userId, token, now + expiresInMs, now);
    return token;
  }

  async function signup() {
    const email = uniqueEmail();
    await client.post("/api/auth/signup", { email, password: "correctpw1", consent: true });
    const row = server.db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    client.clearCookie();
    return { email, userId: row.id };
  }

  test("a missing token is rejected before anything else is checked", async () => {
    const { status, json } = await client.post("/api/auth/reset-password", { password: "newpassword1" });
    assert.equal(status, 400);
    assert.equal(json.error.code, "bad_token");
  });

  test("password length is validated even with a real, valid token", async () => {
    const { userId } = await signup();
    const token = issueResetToken(userId);
    const { status } = await client.post("/api/auth/reset-password", { token, password: "short" });
    assert.equal(status, 400);
    // the token must still be usable - a rejected password shouldn't burn it
    const row = server.db.prepare("SELECT used_at FROM password_reset_tokens WHERE token = ?").get(token);
    assert.equal(row.used_at, null);
  });

  test("an unknown token is rejected", async () => {
    const { status, json } = await client.post("/api/auth/reset-password", { token: "nope", password: "newpassword1" });
    assert.equal(status, 400);
    assert.equal(json.error.code, "bad_token");
  });

  test("a valid token sets the new password, signs a fresh session, and cannot be reused", async () => {
    const { email, userId } = await signup();
    const token = issueResetToken(userId);

    const { status, json, res } = await client.post("/api/auth/reset-password", { token, password: "newpassword1" });
    assert.equal(status, 200);
    assert.equal(json.email, email);
    assert.equal(json.emailVerified, true);
    assert.ok(res.headers.getSetCookie().length > 0);

    const login = await client.post("/api/auth/login", { email, password: "newpassword1" });
    assert.equal(login.status, 200);

    const reuse = await client.post("/api/auth/reset-password", { token, password: "anotherpassword1" });
    assert.equal(reuse.status, 400);
  });

  test("resetting replaces every existing session with a single new one", async () => {
    const { email, userId } = await signup();
    // Two more logins -> two more session rows, plus the one from signup = 3 total.
    await client.post("/api/auth/login", { email, password: "correctpw1" });
    await client.post("/api/auth/login", { email, password: "correctpw1" });
    const before = server.db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?").get(userId).n;
    assert.ok(before >= 2);

    const token = issueResetToken(userId);
    await client.post("/api/auth/reset-password", { token, password: "newpassword1" });

    const after1 = server.db.prepare("SELECT * FROM sessions WHERE user_id = ?").all(userId);
    assert.equal(after1.length, 1);
  });

  test("using one of several outstanding tokens retires all its siblings too", async () => {
    const { userId } = await signup();
    const tokenA = issueResetToken(userId);
    const tokenB = issueResetToken(userId);

    await client.post("/api/auth/reset-password", { token: tokenA, password: "newpassword1" });

    const rowB = server.db.prepare("SELECT used_at FROM password_reset_tokens WHERE token = ?").get(tokenB);
    assert.ok(rowB.used_at, "the sibling token should have been retired even though it wasn't redeemed");
  });

  test("two concurrent requests with the same token: exactly one 200 and one 400", async () => {
    const { userId } = await signup();
    const token = issueResetToken(userId);
    const [a, b] = await Promise.all([
      client.post("/api/auth/reset-password", { token, password: "passwordone1" }),
      client.post("/api/auth/reset-password", { token, password: "passwordtwo2" }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 400]);
  });

  test("a click on the reset link verifies a previously-unverified account too", async () => {
    const { userId, email } = await signup();
    const before1 = server.db.prepare("SELECT email_verified_at FROM users WHERE id = ?").get(userId);
    assert.equal(before1.email_verified_at, null);

    const token = issueResetToken(userId);
    const { json } = await client.post("/api/auth/reset-password", { token, password: "newpassword1" });
    assert.equal(json.emailVerified, true);

    const after1 = server.db.prepare("SELECT email_verified_at FROM users WHERE email = ?").get(email);
    assert.ok(after1.email_verified_at > 0);
  });
});

describe("POST /api/auth/reset-password: revokeTies", () => {
  let server, client;
  before(async () => { server = await startServer({ RESEND_API_KEY: "dummy-test-key" }); client = makeClient(server.baseUrl); });
  after(async () => { await server.stop(); });

  function issueResetToken(userId) {
    const token = crypto.randomBytes(32).toString("hex");
    const now = Date.now();
    server.db.prepare(
      "INSERT INTO password_reset_tokens (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(crypto.randomUUID(), userId, token, now + 3600_000, now);
    return token;
  }

  /** A bare user row inserted directly, with full control over the two columns
   *  looksPreRegistered() reads (email_verified_at, email_verify_required) -
   *  the signup route always sets email_verify_required=1 when email is on,
   *  so a direct insert is the only way to also exercise the legacy (NULL)
   *  and already-verified cases. */
  function makeUser({ emailVerifiedAt = null, emailVerifyRequired = 1 } = {}) {
    const id = crypto.randomUUID();
    const now = Date.now();
    server.db.prepare(
      "INSERT INTO users (id, email, password_hash, created_at, email_verified_at, email_verify_required) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, uniqueEmail(), "some-hash", now, emailVerifiedAt, emailVerifyRequired);
    return id;
  }

  /** Attaches one row of every kind revokeTies() deletes, plus a class this
   *  user teaches (not itself deleted by revokeTies, but its members are). */
  function attachTies(userId) {
    const now = Date.now();
    const otherId = crypto.randomUUID();
    server.db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
      .run(otherId, uniqueEmail(), "some-hash", now);

    server.db.prepare("INSERT INTO links (id, parent_user_id, student_user_id, created_at) VALUES (?, ?, ?, ?)")
      .run(crypto.randomUUID(), otherId, userId, now);
    server.db.prepare("INSERT INTO invite_codes (id, student_user_id, code, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(crypto.randomUUID(), userId, crypto.randomUUID(), now + 3600_000, now);
    const [a, b] = [userId, otherId].sort();
    server.db.prepare("INSERT INTO friend_links (id, user_a_id, user_b_id, created_at) VALUES (?, ?, ?, ?)")
      .run(crypto.randomUUID(), a, b, now);
    server.db.prepare("INSERT INTO friend_codes (id, user_id, code, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(crypto.randomUUID(), userId, crypto.randomUUID(), now + 3600_000, now);
    server.db.prepare("INSERT INTO assigned_sets (id, student_user_id, assigned_by_user_id, doc, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(crypto.randomUUID(), userId, otherId, "{}", now);

    const classId = crypto.randomUUID();
    server.db.prepare("INSERT INTO classes (id, teacher_user_id, name, code, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(classId, otherId, "Test class", crypto.randomUUID(), now);
    server.db.prepare("INSERT INTO class_members (class_id, student_user_id, joined_at) VALUES (?, ?, ?)")
      .run(classId, userId, now);

    return {
      countTies: () => ({
        links: server.db.prepare("SELECT COUNT(*) AS n FROM links WHERE parent_user_id = ? OR student_user_id = ?").get(userId, userId).n,
        inviteCodes: server.db.prepare("SELECT COUNT(*) AS n FROM invite_codes WHERE student_user_id = ?").get(userId).n,
        friendLinks: server.db.prepare("SELECT COUNT(*) AS n FROM friend_links WHERE user_a_id = ? OR user_b_id = ?").get(userId, userId).n,
        friendCodes: server.db.prepare("SELECT COUNT(*) AS n FROM friend_codes WHERE user_id = ?").get(userId).n,
        assignedSets: server.db.prepare("SELECT COUNT(*) AS n FROM assigned_sets WHERE student_user_id = ?").get(userId).n,
        classMembers: server.db.prepare("SELECT COUNT(*) AS n FROM class_members WHERE student_user_id = ?").get(userId).n,
      }),
    };
  }

  test("an unverified account made while verification was required loses every tie on reset", async () => {
    const userId = makeUser({ emailVerifiedAt: null, emailVerifyRequired: 1 });
    const { countTies } = attachTies(userId);
    const before1 = countTies();
    assert.ok(Object.values(before1).every((n) => n === 1));

    const token = issueResetToken(userId);
    await client.post("/api/auth/reset-password", { token, password: "newpassword1" });

    const after1 = countTies();
    assert.ok(Object.values(after1).every((n) => n === 0), `expected every tie gone, got ${JSON.stringify(after1)}`);
  });

  test("a legacy account (email_verify_required is NULL) keeps its ties on reset", async () => {
    const userId = makeUser({ emailVerifiedAt: null, emailVerifyRequired: null });
    const { countTies } = attachTies(userId);

    const token = issueResetToken(userId);
    await client.post("/api/auth/reset-password", { token, password: "newpassword1" });

    const after1 = countTies();
    assert.ok(Object.values(after1).every((n) => n === 1), `expected ties kept, got ${JSON.stringify(after1)}`);
  });

  test("an already-verified account keeps its ties on reset", async () => {
    const userId = makeUser({ emailVerifiedAt: Date.now(), emailVerifyRequired: 1 });
    const { countTies } = attachTies(userId);

    const token = issueResetToken(userId);
    await client.post("/api/auth/reset-password", { token, password: "newpassword1" });

    const after1 = countTies();
    assert.ok(Object.values(after1).every((n) => n === 1), `expected ties kept, got ${JSON.stringify(after1)}`);
  });
});

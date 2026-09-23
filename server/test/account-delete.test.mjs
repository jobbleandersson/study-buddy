import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { startServer, makeClient } from "./harness.mjs";

const uniqueEmail = () => `delete-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

describe("DELETE /api/account", () => {
  let server, client;
  before(async () => { server = await startServer(); client = makeClient(server.baseUrl); });
  after(async () => { await server.stop(); });

  test("requires a signed-in session", async () => {
    client.clearCookie();
    const { status } = await client.delete("/api/account", { password: "whatever1" });
    assert.equal(status, 401);
  });

  test("a wrong password is rejected with confirm_mismatch, and the account survives", async () => {
    const email = uniqueEmail();
    await client.post("/api/auth/signup", { email, password: "correctpw1", consent: true });
    const { status, json } = await client.delete("/api/account", { password: "wrongpassword" });
    assert.equal(status, 403);
    assert.equal(json.error.code, "confirm_mismatch");

    const row = server.db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    assert.ok(row);
  });

  test("a Google-linked account is confirmed by typed email, not a password", async () => {
    const email = uniqueEmail();
    const now = Date.now();
    const id = crypto.randomUUID();
    server.db.prepare(
      "INSERT INTO users (id, email, password_hash, google_sub, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(id, email, "unusable-hash", "google-sub-xyz", now);
    server.db.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(crypto.randomUUID(), id, now + 3600_000, now);
    // makeClient never logged in through the API for this user, so hand it
    // the cookie for the session row just inserted directly.
    client.cookie = `sb_session=${server.db.prepare("SELECT id FROM sessions WHERE user_id = ?").get(id).id}`;

    const wrongEmail = await client.delete("/api/account", { email: "someone-else@example.com" });
    assert.equal(wrongEmail.status, 403);
    assert.equal(wrongEmail.json.error.code, "confirm_mismatch");

    const right = await client.delete("/api/account", { email });
    assert.equal(right.status, 200);
    assert.equal(server.db.prepare("SELECT id FROM users WHERE id = ?").get(id), undefined);
  });

  test("deleting removes every dependent row across every table it touches", async () => {
    const email = uniqueEmail();
    await client.post("/api/auth/signup", { email, password: "correctpw1", consent: true });
    const userId = server.db.prepare("SELECT id FROM users WHERE email = ?").get(email).id;
    const now = Date.now();

    const otherId = crypto.randomUUID();
    server.db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
      .run(otherId, uniqueEmail(), "some-hash", now);

    // One row of everything account.js's delete transaction names, plus a
    // class this account teaches, with a member, an assignment and a daily
    // question someone answered.
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
    server.db.prepare("INSERT INTO email_verify_tokens (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(crypto.randomUUID(), userId, crypto.randomUUID(), now + 3600_000, now);
    server.db.prepare("INSERT INTO password_reset_tokens (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(crypto.randomUUID(), userId, crypto.randomUUID(), now + 3600_000, now);
    server.db.prepare("INSERT INTO ai_usage (user_id, period, input_tokens, output_tokens, request_count, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(userId, "2026-01", 100, 200, 1, now);
    server.db.prepare("INSERT INTO state_blobs (user_id, version, blob, updated_at) VALUES (?, ?, ?, ?)")
      .run(userId, 1, "{}", now);
    server.db.prepare("INSERT INTO premium_waitlist (id, email, created_at) VALUES (?, ?, ?)")
      .run(crypto.randomUUID(), email, now); // under the account's own address
    const keptWaitlistId = crypto.randomUUID();
    const otherEmail = uniqueEmail();
    server.db.prepare("INSERT INTO premium_waitlist (id, email, created_at) VALUES (?, ?, ?)")
      .run(keptWaitlistId, otherEmail, now); // a different address - must survive

    const classId = crypto.randomUUID();
    server.db.prepare("INSERT INTO classes (id, teacher_user_id, name, code, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(classId, userId, "Taught class", crypto.randomUUID(), now);
    server.db.prepare("INSERT INTO class_members (class_id, student_user_id, joined_at) VALUES (?, ?, ?)")
      .run(classId, otherId, now);
    server.db.prepare("INSERT INTO class_assignments (id, class_id, set_id, created_at) VALUES (?, ?, ?, ?)")
      .run(crypto.randomUUID(), classId, "lib-some-set", now);
    const dailyId = crypto.randomUUID();
    server.db.prepare("INSERT INTO class_daily (id, class_id, day, prompt, choices, answer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(dailyId, classId, "2026-01-01", "Q?", "[]", 0, now);
    server.db.prepare("INSERT INTO class_daily_answers (daily_id, student_user_id, choice, answered_at) VALUES (?, ?, ?, ?)")
      .run(dailyId, otherId, 0, now);

    const { status } = await client.delete("/api/account", { password: "correctpw1" });
    assert.equal(status, 200);

    const tables = [
      ["users", "id = ?", userId],
      ["sessions", "user_id = ?", userId],
      ["links", "parent_user_id = ? OR student_user_id = ?", [userId, userId]],
      ["invite_codes", "student_user_id = ?", userId],
      ["friend_links", "user_a_id = ? OR user_b_id = ?", [userId, userId]],
      ["friend_codes", "user_id = ?", userId],
      ["assigned_sets", "student_user_id = ? OR assigned_by_user_id = ?", [userId, userId]],
      ["email_verify_tokens", "user_id = ?", userId],
      ["password_reset_tokens", "user_id = ?", userId],
      ["ai_usage", "user_id = ?", userId],
      ["state_blobs", "user_id = ?", userId],
      ["classes", "teacher_user_id = ?", userId],
      ["class_members", "class_id = ?", classId],
      ["class_assignments", "class_id = ?", classId],
      ["class_daily", "class_id = ?", classId],
      ["class_daily_answers", "daily_id = ?", dailyId],
    ];
    for (const [table, where, params] of tables) {
      const args = Array.isArray(params) ? params : [params];
      const n = server.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...args).n;
      assert.equal(n, 0, `expected ${table} to have no rows left for this account`);
    }

    const ownWaitlist = server.db.prepare("SELECT id FROM premium_waitlist WHERE email = ?").get(email);
    assert.equal(ownWaitlist, undefined, "the waitlist row under the deleted account's own email should be gone");
    const otherWaitlist = server.db.prepare("SELECT id FROM premium_waitlist WHERE email = ?").get(otherEmail);
    assert.ok(otherWaitlist, "a waitlist row under a different address should survive");
  });

  test("account-delete failures are rate-limited per account after repeated wrong passwords", async () => {
    const email = uniqueEmail();
    await client.post("/api/auth/signup", { email, password: "correctpw1", consent: true });
    let last;
    for (let i = 0; i < 6; i++) {
      last = await client.delete("/api/account", { password: "wrongpassword" });
    }
    assert.equal(last.status, 429);
  });
});

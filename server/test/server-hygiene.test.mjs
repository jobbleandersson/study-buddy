import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { startServer, makeClient } from "./harness.mjs";

// Sweep findings B1 (bad input answered 500 and mailed the owner), S3 (bcrypt reads 72 bytes) and S5 (old
// email-change requests were never cleaned up).

describe("bad input is a 400, not a server error (B1)", () => {
  let server, client;
  before(async () => {
    server = await startServer();
    client = makeClient(server.baseUrl);
    const r = await client.post("/api/auth/signup", { email: `hyg-${Date.now()}@example.com`, password: "longenough1", consent: true });
    assert.equal(r.status, 200);
  });
  after(async () => { await server.stop(); });

  test("a calendar-impossible day that matches YYYY-MM-DD", async () => {
    const r = await client.get("/api/my-daily?day=2026-13-99");
    assert.equal(r.status, 400);
  });

  test("a class assignment due on 2026-13-45", async () => {
    const c = await client.post("/api/classes", { name: "9B" });
    assert.equal(c.status, 200);
    const r = await client.post(`/api/classes/${c.json.class?.id ?? c.json.id}/assignments`, { setId: "lib-bio7-djur", dueAt: "2026-13-45" });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.message, "That date isn't valid.", "turned away for the date, not the set");
  });

  test("broken %-encoding in a path", async () => {
    const r = await client.get("/api/classes/%ff");
    assert.equal(r.status, 400);
    assert.equal(r.json?.error?.code, "bad_request");
  });

  test("none of them was logged as a server error", () => {
    assert.equal(/error on GET \/api\/classes\/%ff|RangeError|URIError/.test(server.logLines.join("")), false);
  });
});

describe("new passwords stop at 72 bytes (S3)", async () => {
  const { passwordProblem } = await import("../src/passwordRules.js");
  test("72 ASCII characters are fine, 73 are too long", () => {
    assert.equal(passwordProblem("a1".repeat(36)), null);
    assert.equal(passwordProblem("a1".repeat(36) + "x"), "Password is too long.");
  });
  test("counted in bytes: 37 'ö' are 74 bytes", () => {
    assert.equal(passwordProblem("ö".repeat(37)), "Password is too long.");
  });
});

describe("the sweep removes used and expired email-change requests (S5)", async () => {
  process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), "sb-hygiene-")), "test.sqlite3");
  const { db } = await import("../src/db.js");
  const { runSweep } = await import("../src/sweep.js");
  test("expired and used rows go, a live one stays", () => {
    const uid = crypto.randomUUID(), now = Date.now();
    db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, 'x', ?)").run(uid, `s5-${now}@example.com`, now);
    const add = (id, expiresAt, usedAt) => db.prepare(
      "INSERT INTO email_change_tokens (id, user_id, new_email, token, expires_at, used_at, created_at) VALUES (?, ?, 'someone@example.com', ?, ?, ?, ?)"
    ).run(id, uid, `tok-${id}`, expiresAt, usedAt, now);
    add("expired", now - 1000, null);
    add("used", now + 3600_000, now - 10);
    add("live", now + 3600_000, null);
    runSweep(now);
    assert.deepEqual(db.prepare("SELECT id FROM email_change_tokens").all().map((r) => r.id), ["live"]);
  });
});

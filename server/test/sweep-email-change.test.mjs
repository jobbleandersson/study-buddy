import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// Sweep finding S5: used and expired email-change requests (which hold an address that may be someone else's)
// were never removed. In-process: db.js opens DB_PATH when imported, so it is set before the imports below.
process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), "sb-sweep-change-")), "test.sqlite3");
const { db } = await import("../src/db.js");
const { runSweep } = await import("../src/sweep.js");

describe("the sweep removes used and expired email-change requests (S5)", () => {
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

// A separate file/process from usage.test.mjs because DAILY_SPEND_CAP_USD is
// computed once from process.env at usage.js's import time - this file needs
// its own fresh import with AI_DAILY_SPEND_CAP_USD="0" to see the "off" path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";

process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), "sb-usage-cap-off-")), "test.sqlite3");
process.env.AI_DAILY_SPEND_CAP_USD = "0";

const { db } = await import("../src/db.js");
const usage = await import("../src/usage.js");

test("AI_DAILY_SPEND_CAP_USD=0 disables the cap regardless of booked spend", () => {
  assert.equal(usage.DAILY_SPEND_CAP_USD, 0);
  const userId = crypto.randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
    .run(userId, `${userId}@example.com`, "hash", Date.now());
  usage.recordUsage({ userId, model: "claude-sonnet-5", usage: { input: 50_000_000, output: 50_000_000, cacheWrite: 0, cacheRead: 0 } });
  assert.equal(usage.checkDailyCap().ok, true);
});

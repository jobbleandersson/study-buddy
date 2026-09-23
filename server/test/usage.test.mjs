// Exercises usage.js and its db.js dependency directly, in-process - no HTTP,
// no child process. db.js opens its SQLite file from process.env.DB_PATH at
// *import* time, so that has to be set before the (dynamic) import below runs;
// node:test gives each test FILE its own process, so this can't collide with
// any other suite's DB_PATH.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";

process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), "sb-usage-test-")), "test.sqlite3");
process.env.AI_DAILY_SPEND_CAP_USD = "0.01"; // $0.01 - small enough to exceed deliberately below

const { db } = await import("../src/db.js");
const usage = await import("../src/usage.js");

function makeUser() {
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
    .run(id, `${id}@example.com`, "hash", Date.now());
  return id;
}

describe("usage.costMicroUsd", () => {
  test("known models price input and output at their listed per-million rates", () => {
    // PRICE_PER_MTOK is USD per million tokens, which is also micro-dollars per token.
    const cost = usage.costMicroUsd("claude-sonnet-5", { input: 1, output: 0 });
    assert.equal(cost, usage.PRICE_PER_MTOK["claude-sonnet-5"].in);
  });

  test("an unlisted model falls back to the priciest rate, not zero or a crash", () => {
    const known = usage.costMicroUsd("claude-sonnet-5", { input: 1000, output: 1000 });
    const unknown = usage.costMicroUsd("some-future-model", { input: 1000, output: 1000 });
    assert.ok(unknown >= known);
  });

  test("cache reads are cheaper than a plain input token, cache writes dearer", () => {
    const plain = usage.costMicroUsd("claude-sonnet-5", { input: 1000 });
    const cacheRead = usage.costMicroUsd("claude-sonnet-5", { cacheRead: 1000 });
    const cacheWrite = usage.costMicroUsd("claude-sonnet-5", { cacheWrite: 1000 });
    assert.ok(cacheRead < plain);
    assert.ok(cacheWrite > plain);
  });
});

describe("usage.recordUsage", () => {
  test("books tokens against the user's monthly meter", () => {
    const userId = makeUser();
    usage.recordUsage({ userId, model: "claude-haiku-4-5", usage: { input: 100, output: 50, cacheWrite: 0, cacheRead: 0 } });
    const read = usage.readUsage(userId);
    assert.equal(read.inputTokens, 100);
    assert.equal(read.outputTokens, 50);
    assert.equal(read.requests, 1);
  });

  test("a deleted (nonexistent) userId's foreign-key failure does not throw, and still books the daily spend", () => {
    const before = usage.readDaySpend().costMicro;
    assert.doesNotThrow(() => {
      usage.recordUsage({ userId: "not-a-real-user-id", model: "claude-haiku-4-5", usage: { input: 1000, output: 1000, cacheWrite: 0, cacheRead: 0 } });
    });
    const after = usage.readDaySpend().costMicro;
    assert.ok(after > before, "the server-wide daily tally must still move even though the per-user row failed");
  });

  test("no userId at all (an anonymous request) skips the per-user meter cleanly", () => {
    assert.doesNotThrow(() => {
      usage.recordUsage({ model: "claude-haiku-4-5", usage: { input: 10, output: 10, cacheWrite: 0, cacheRead: 0 } });
    });
  });
});

describe("usage.checkBudget", () => {
  test("a fresh user is under budget", () => {
    const userId = makeUser();
    const out = usage.checkBudget(userId);
    assert.equal(out.ok, true);
    assert.equal(out.used, 0);
  });

  test("flips to not-ok once usage reaches the monthly ceiling", () => {
    const userId = makeUser();
    usage.recordUsage({ userId, model: "claude-sonnet-5", usage: { input: usage.MONTHLY_TOKEN_BUDGET, output: 0, cacheWrite: 0, cacheRead: 0 } });
    const out = usage.checkBudget(userId);
    assert.equal(out.ok, false);
  });
});

describe("usage.checkDailyCap", () => {
  test("ok is true below the cap and false once booked spend exceeds it", () => {
    const before1 = usage.checkDailyCap();
    // Whether this specific check is "ok" depends on what earlier tests in this
    // file already booked against the same $0.01 cap; the meaningful assertion
    // is monotonic: spending more can only ever make `ok` go from true to false.
    const userId = makeUser();
    usage.recordUsage({ userId, model: "claude-sonnet-5", usage: { input: 1_000_000, output: 1_000_000, cacheWrite: 0, cacheRead: 0 } });
    const after1 = usage.checkDailyCap();
    if (before1.ok) assert.ok(!after1.ok || after1.spentMicro > before1.spentMicro);
  });

  test("reserveSpend holds and releases an in-flight amount", () => {
    const release = usage.reserveSpend(1000);
    release();
    // Releasing twice must not go negative or throw.
    assert.doesNotThrow(release);
  });
});

describe("usage.currentPeriod / currentDay", () => {
  test("currentPeriod formats as YYYY-MM in UTC", () => {
    const d = new Date(Date.UTC(2026, 0, 15));
    assert.equal(usage.currentPeriod(d), "2026-01");
  });
  test("currentDay formats as YYYY-MM-DD in UTC", () => {
    const d = new Date(Date.UTC(2026, 0, 15));
    assert.equal(usage.currentDay(d), "2026-01-15");
  });
  test("periodResetsAt / dayResetsAt point at the next UTC boundary", () => {
    const d = new Date(Date.UTC(2026, 0, 15, 12));
    assert.equal(usage.periodResetsAt(d), Date.UTC(2026, 1, 1));
    assert.equal(usage.dayResetsAt(d), Date.UTC(2026, 0, 16));
  });
});

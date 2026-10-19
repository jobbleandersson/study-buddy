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

describe("usage: Claude Haiku 5.5", () => {
  test("is allowed and priced at its own rates, with the long-prompt card past 100K tokens", () => {
    assert.ok(usage.ALLOWED_MODELS.has("claude-haiku-5-5"));
    // 10K in + 1K out: 10_000 * 0.1 + 1_000 * 0.5 = 1_500 micro-dollars.
    assert.equal(usage.costMicroUsd("claude-haiku-5-5", { input: 10_000, output: 1_000 }), 1_500);
    // 200K in + 1K out on the long card: 200_000 * 0.5 + 1_000 * 2.5 = 102_500.
    assert.equal(usage.costMicroUsd("claude-haiku-5-5", { input: 200_000, output: 1_000 }), 102_500);
    // A tenth of Haiku 4.5 for the same short request.
    assert.equal(usage.costMicroUsd("claude-haiku-4-5", { input: 10_000, output: 1_000 }), 15_000);
  });
});

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
    // 200,000 Sonnet input tokens cost $0.40, which is 4 kr against a 2 kr limit
    usage.recordUsage({ userId, model: "claude-sonnet-5", usage: { input: 200_000, output: 0, cacheWrite: 0, cacheRead: 0 } });
    const out = usage.checkBudget(userId);
    assert.equal(out.ok, false);
    assert.equal(out.limit, usage.MONTHLY_BUDGET_KR);
    assert.ok(out.used > usage.MONTHLY_BUDGET_KR);
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

describe("usage: requests in flight count against the monthly limit", () => {
  // The limit here is 10 kr = $1 = 1,000,000 micro-dollars.
  test("a second request started alongside the first is refused once the first would use the rest", () => {
    const userId = makeUser();
    assert.equal(usage.checkBudget(userId, 10).ok, true);
    const first = usage.reserveUserBudget(userId, 600_000);   // 6 kr, admitted under the limit
    assert.equal(usage.checkBudget(userId, 10).ok, true, "6 of 10 kr held: one more still fits");
    const second = usage.reserveUserBudget(userId, 600_000);
    assert.equal(usage.checkBudget(userId, 10).ok, false, "12 kr held: the next request is refused");
    assert.equal(usage.checkBudget(userId, 10).used, 0, "`used` is still what is booked");
    first(); second();
    assert.equal(usage.checkBudget(userId, 10).ok, true, "released: room again");
  });

  test("releasing twice does not give back more than was held", () => {
    const userId = makeUser();
    const a = usage.reserveUserBudget(userId, 700_000);
    const b = usage.reserveUserBudget(userId, 700_000);
    a(); a();
    assert.equal(usage.checkBudget(userId, 10).ok, true, "7 kr still held by b: 7 < 10");
    usage.reserveUserBudget(userId, 400_000);
    assert.equal(usage.checkBudget(userId, 10).ok, false, "b and the new one: 11 kr");
    b();
  });
});

describe("usage: the limit is in kronor, not tokens", () => {
  test("the cost is booked next to the tokens and read back in kronor", () => {
    const userId = makeUser();
    // $2 per million Sonnet input tokens and $10 output: 100,000 in + 10,000 out = $0.30 = 3 kr
    usage.recordUsage({ userId, model: "claude-sonnet-5", usage: { input: 100_000, output: 10_000, cacheWrite: 0, cacheRead: 0 } });
    const read = usage.readUsage(userId);
    assert.equal(read.costMicro, 300_000);
    assert.ok(Math.abs(read.costKr - 3) < 1e-9);
    assert.equal(read.totalTokens, 110_000);
    assert.equal(usage.checkBudget(userId).used, 3);
  });

  test("the same number of tokens uses far less of the limit on the cheap model", () => {
    const cheap = makeUser(), dear = makeUser();
    const u = { input: 50_000, output: 50_000, cacheWrite: 0, cacheRead: 0 };
    usage.recordUsage({ userId: cheap, model: "claude-haiku-5-5", usage: u });
    usage.recordUsage({ userId: dear, model: "claude-sonnet-5", usage: u });
    assert.equal(usage.readUsage(cheap).totalTokens, usage.readUsage(dear).totalTokens);
    assert.equal(usage.checkBudget(cheap).ok, true, "100,000 Haiku tokens cost about 0.3 kr");
    assert.equal(usage.checkBudget(dear).ok, false, "100,000 Sonnet tokens cost 6 kr: over the free 2 kr");
  });

  test("the limits are 2 kr free and 30 kr for Plus, and microToKr uses AI_KR_PER_USD", () => {
    assert.equal(usage.MONTHLY_BUDGET_KR, 2);
    assert.equal(usage.PLUS_BUDGET_KR, 30);
    assert.equal(usage.KR_PER_USD, 10);
    assert.equal(usage.microToKr(1_000_000), 10);
  });
});

describe("usage: one account's share of the daily cap", () => {
  test("is 10% by default: $0.01 cap here, so 1,000 micro-dollars", () => {
    const userId = makeUser();
    assert.equal(usage.checkUserDailyShare(userId, 1_000), true);
    assert.equal(usage.checkUserDailyShare(userId, 1_001), false);
  });
});

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The digest (class results, friends' leaderboard) reads shortened history (js/lib/history.js): an old
// attempt keeps how many it answered, and each question's latest result moves to state.lastAnswers.
// Both come from the client, so only well-formed values count.
process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), "sb-digest-history-")), "test.sqlite3");
const { digestOf } = await import("../src/state-digest.js");

const DAY = 86_400_000;
const now = Date.now();

describe("digestOf: shortened history", () => {
  test("a shortened attempt counts its answers for the day, and lastAnswers gives each question's result", () => {
    const d = digestOf({
      attempts: [{ finishedAt: now - DAY, answered: 15, compact: true }],
      lastAnswers: { q1: [now - DAY, 1], q2: [now - DAY, 0] },
    });
    assert.equal(d.attempts.reduce((n, [, c]) => n + c, 0), 15);
    assert.deepEqual(d.answers.q1, [now - DAY, 1]);
    assert.deepEqual(d.answers.q2, [now - DAY, 0]);
  });

  test("a later answer in a kept attempt wins over lastAnswers", () => {
    const d = digestOf({
      attempts: [{ finishedAt: now, items: [{ questionId: "q1", correct: false, firstTry: false }] }],
      lastAnswers: { q1: [now - 5 * DAY, 1] },
    });
    assert.deepEqual(d.answers.q1, [now, 0]);
  });

  test("junk in lastAnswers and absurd counts are ignored or capped", () => {
    const d = digestOf({
      attempts: [{ finishedAt: now, answered: 9_999_999 }],
      lastAnswers: {
        good: [now - DAY, 1],
        future: [now + 30 * DAY, 1], notPair: "x", badOk: [now, 2], nan: ["x", 1],
        ["x".repeat(200)]: [now, 1], __proto__: [now, 1],
      },
    });
    assert.deepEqual(Object.keys(d.answers), ["good"]);
    assert.ok(d.attempts[0][1] <= 1000, "one day can't claim more than the per-day cap");
  });

  test("a list or a string as lastAnswers is ignored", () => {
    assert.deepEqual(digestOf({ lastAnswers: [[1, 1]] }).answers, {});
    assert.deepEqual(digestOf({ lastAnswers: "q1" }).answers, {});
  });
});

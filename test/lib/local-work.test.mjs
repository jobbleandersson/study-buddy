import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { localWorkCounts, hasLocalWork } from "../../js/lib/local-work.js";

describe("local work", () => {
  test("a fresh or missing state has none", () => {
    assert.equal(hasLocalWork(null), false);
    assert.equal(hasLocalWork({}), false);
    assert.equal(hasLocalWork({ assignments: [], exams: [], rules: [], attempts: [], activity: { daysStudied: [] } }), false);
  });
  test("each kind of work counts", () => {
    assert.equal(hasLocalWork({ assignments: [{}] }), true);
    assert.equal(hasLocalWork({ exams: [{}] }), true);
    assert.equal(hasLocalWork({ rules: [{}] }), true);
    assert.equal(hasLocalWork({ attempts: [{}] }), true);
    assert.equal(hasLocalWork({ activity: { daysStudied: ["2026-10-01"] } }), true);
    assert.deepEqual(localWorkCounts({ assignments: [{}, {}], attempts: [{}] }), { sets: 2, tests: 0, rules: 0, attempts: 1, days: 0 });
  });
});

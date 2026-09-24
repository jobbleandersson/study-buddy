import "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { examCells, examSummary, toggleFlag } from "../../js/lib/exam-nav.js";

const order = ["a", "b", "c", "d"];
const items = { a: { correct: true }, c: { correct: false } };

describe("exam-nav.examCells", () => {
  test("numbers cells from 1 in the fixed order and marks answered / flagged / current", () => {
    const cells = examCells(order, items, ["b", "c"], 1);
    assert.deepEqual(cells.map((c) => c.n), [1, 2, 3, 4]);
    assert.deepEqual(cells.map((c) => c.answered), [true, false, true, false]);
    assert.deepEqual(cells.map((c) => c.flagged), [false, true, true, false]);
    assert.deepEqual(cells.map((c) => c.current), [false, true, false, false]);
  });

  test("a wrong answer still counts as answered (the map shows progress, not marks)", () => {
    assert.equal(examCells(order, items, [], 0)[2].answered, true);
  });

  test("tolerates missing lists", () => {
    assert.deepEqual(examCells(undefined, undefined, undefined, 0), []);
    assert.equal(examCells(["x"], undefined, undefined, 0)[0].answered, false);
  });
});

describe("exam-nav.examSummary", () => {
  test("counts answered, unanswered, flagged and flagged-but-unanswered", () => {
    assert.deepEqual(examSummary(order, items, ["b", "c"]),
      { total: 4, answered: 2, unanswered: 2, flagged: 2, flaggedOpen: 1 });
  });

  test("an empty exam has all zeros", () => {
    assert.deepEqual(examSummary([], {}, []), { total: 0, answered: 0, unanswered: 0, flagged: 0, flaggedOpen: 0 });
  });

  test("ignores flags on ids that are not in the exam", () => {
    assert.equal(examSummary(order, items, ["zzz"]).flagged, 0);
  });
});

describe("exam-nav.toggleFlag", () => {
  test("adds, then removes, without mutating the input", () => {
    const start = ["a"];
    const added = toggleFlag(start, "b");
    assert.deepEqual(added, ["a", "b"]);
    assert.deepEqual(start, ["a"]);
    assert.deepEqual(toggleFlag(added, "a"), ["b"]);
  });

  test("works from undefined", () => {
    assert.deepEqual(toggleFlag(undefined, "x"), ["x"]);
  });
});

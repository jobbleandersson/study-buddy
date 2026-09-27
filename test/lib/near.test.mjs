import "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { nearlyThere } from "../../js/lib/near.js";

const set = (id, n = 5) => ({ id, title: id, questions: Array.from({ length: n }, (_, i) => ({ id: `${id}${i}` })) });
const at = (assignmentId, scorePct, finishedAt = 1, extra = {}) => ({ assignmentId, scorePct, finishedAt, ...extra });

describe("nearlyThere", () => {
  test("lists sets whose best score is short of full, closest first", () => {
    const { items, total } = nearlyThere([set("a"), set("b"), set("c")], [at("a", 70), at("b", 90), at("c", 100)]);
    assert.deepEqual(items.map((s) => s.assignment.id), ["b", "a"]);
    assert.equal(total, 2);
  });

  test("uses the best attempt, counts attempts and remembers the latest", () => {
    const { items } = nearlyThere([set("a")], [at("a", 60, 10), at("a", 80, 20), at("a", 70, 30)]);
    assert.equal(items[0].best, 80);
    assert.equal(items[0].attempts, 3);
    assert.equal(items[0].last, 30);
  });

  test("a set that was ever finished at 100 % is done, even if a later run was worse", () => {
    assert.equal(nearlyThere([set("a")], [at("a", 100), at("a", 60)]).total, 0);
  });

  test("ignores review runs, attempts without a set, and sets with no questions", () => {
    const attempts = [at("a", 80, 1, { isReview: true }), at("gone", 80), at("empty", 80)];
    assert.equal(nearlyThere([set("a"), set("empty", 0)], attempts).total, 0);
  });

  test("far-off scores are not 'almost there'", () => {
    assert.equal(nearlyThere([set("a")], [at("a", 30)]).total, 0);
    assert.equal(nearlyThere([set("a")], [at("a", 30)], { min: 0 }).total, 1);
  });

  test("limit caps the list but total still counts everything that qualifies", () => {
    const sets = ["a", "b", "c", "d"].map((id) => set(id));
    const { items, total } = nearlyThere(sets, sets.map((s, i) => at(s.id, 60 + i)), { limit: 2 });
    assert.equal(items.length, 2);
    assert.equal(total, 4);
    assert.equal(items[0].assignment.id, "d");
  });

  test("copes with missing input", () => {
    assert.deepEqual(nearlyThere(undefined, undefined), { items: [], total: 0 });
  });

  test("ties on score fall back to the most recently practised", () => {
    const { items } = nearlyThere([set("a"), set("b")], [at("a", 80, 5), at("b", 80, 9)]);
    assert.equal(items[0].assignment.id, "b");
  });
});

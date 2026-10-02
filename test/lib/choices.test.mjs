import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { choicesDependOnOrder, shuffledIndexes, shuffleMc } from "../../js/lib/choices.js";

// A tiny seeded generator, so these never flake.
const seeded = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

describe("choices.choicesDependOnOrder", () => {
  test("options that point at the others are order-dependent", () => {
    for (const set of [
      ["Fel", "Rätt", "Alla ovanstående"], ["1", "2", "Både A och B"], ["x", "y", "None of the above"],
      ["a", "b", "All of the above"], ["x", "Alternativ B och C", "z"], ["Inget av alternativen", "ett", "två"],
      ["A and B", "C", "D"], ["x", "y", "see the options below"],
    ]) assert.equal(choicesDependOnOrder(set), true, set.join(" | "));
  });
  test("ordinary options are not", () => {
    for (const set of [["Stockholm", "Oslo", "Helsingfors"], ["2x + 3", "x + 5", "5x"], ["Vitamin D", "Järn", "Kalcium"], []]) {
      assert.equal(choicesDependOnOrder(set), false, set.join(" | "));
    }
  });
});

describe("choices.shuffleMc", () => {
  const q = { choices: ["rätt", "fel 1", "fel 2", "fel 3"], answer: 0 };
  test("the answer index follows the correct option", () => {
    for (let s = 1; s <= 40; s++) {
      const out = shuffleMc(q, seeded(s));
      assert.deepEqual([...out.choices].sort(), [...q.choices].sort());
      assert.equal(out.choices[out.answer], "rätt");
    }
  });
  test("the correct option no longer always comes first", () => {
    const spots = new Set();
    for (let s = 1; s <= 60; s++) spots.add(shuffleMc(q, seeded(s)).answer);
    assert.deepEqual([...spots].sort(), [0, 1, 2, 3]);
  });
  test("order-dependent and malformed questions come back untouched", () => {
    const dep = { choices: ["a", "b", "Alla ovanstående"], answer: 2 };
    assert.deepEqual(shuffleMc(dep, seeded(1)), dep);
    assert.deepEqual(shuffleMc({ choices: ["only"], answer: 0 }), { choices: ["only"], answer: 0 });
    assert.deepEqual(shuffleMc({ choices: ["a", "b"], answer: 5 }), { choices: ["a", "b"], answer: 5 });
    assert.deepEqual(shuffleMc({ choices: undefined, answer: 0 }), { choices: undefined, answer: 0 });
  });
});

describe("choices.shuffledIndexes", () => {
  test("is a permutation", () => {
    assert.deepEqual(shuffledIndexes(5, seeded(3)).sort(), [0, 1, 2, 3, 4]);
    assert.deepEqual(shuffledIndexes(0), []);
  });
});

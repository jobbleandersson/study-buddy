import "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { deepClone } from "../../js/lib/clone.js";

describe("deepClone", () => {
  const set = { id: "a", questions: [{ id: "q", choices: ["x", "y"], steps: null, n: 1 }], meta: { t: true } };
  test("copies deeply with structuredClone", () => {
    const c = deepClone(set);
    assert.deepEqual(c, set);
    c.questions[0].choices.push("z");
    assert.equal(set.questions[0].choices.length, 2);
  });
  test("still copies when structuredClone does not exist (iOS 15.0 to 15.3)", () => {
    const saved = globalThis.structuredClone;
    try {
      delete globalThis.structuredClone;
      const c = deepClone(set);
      assert.deepEqual(c, set);
      c.questions[0].id = "changed";
      assert.equal(set.questions[0].id, "q");
      assert.equal(deepClone(undefined), undefined);
    } finally { globalThis.structuredClone = saved; }
  });
});

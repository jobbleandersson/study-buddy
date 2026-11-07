import "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { onLeave, runLeaveHooks } from "../../js/lib/leave-hooks.js";

describe("leave hooks", () => {
  test("every registered hook runs on a navigation, and a hook can be taken off again", () => {
    const ran = [];
    const off = onLeave(() => ran.push("a"));
    onLeave(() => ran.push("b"));
    runLeaveHooks();
    assert.deepEqual(ran, ["a", "b"]);
    off();
    ran.length = 0;
    runLeaveHooks();
    assert.deepEqual(ran, ["b"]);
  });

  test("a hook that throws never stops the others", () => {
    const ran = [];
    onLeave(() => { throw new Error("boom"); });
    onLeave(() => ran.push("after"));
    assert.doesNotThrow(() => runLeaveHooks());
    assert.ok(ran.includes("after"));
  });
});

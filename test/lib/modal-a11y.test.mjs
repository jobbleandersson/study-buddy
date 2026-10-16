// The pure part of lib/modal-a11y.js: where Tab / Shift+Tab goes inside an open dialog.
import test from "node:test";
import assert from "node:assert/strict";
import { cycleTarget } from "../../js/lib/modal-a11y.js";

const [a, b, c] = ["a", "b", "c"];

test("Tab on the last control wraps to the first, Shift+Tab on the first to the last", () => {
  assert.equal(cycleTarget([a, b, c], c, false), a);
  assert.equal(cycleTarget([a, b, c], a, true), c);
});

test("Tab in the middle is left to the browser", () => {
  assert.equal(cycleTarget([a, b, c], b, false), null);
  assert.equal(cycleTarget([a, b, c], b, true), null);
  assert.equal(cycleTarget([a, b, c], a, false), null);
  assert.equal(cycleTarget([a, b, c], c, true), null);
});

test("focus outside the dialog (or on its frame) is pulled back in", () => {
  assert.equal(cycleTarget([a, b, c], "elsewhere", false), a);
  assert.equal(cycleTarget([a, b, c], "elsewhere", true), c);
});

test("a dialog with one control keeps focus on it; with none there is nowhere to go", () => {
  assert.equal(cycleTarget([a], a, false), a);
  assert.equal(cycleTarget([a], a, true), a);
  assert.equal(cycleTarget([], a, false), null);
});

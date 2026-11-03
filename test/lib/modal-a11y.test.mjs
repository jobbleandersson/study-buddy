// The pure part of lib/modal-a11y.js: where Tab / Shift+Tab goes inside an open dialog.
import test from "node:test";
import assert from "node:assert/strict";
import { cycleTarget, menuStep, tabLeaves } from "../../js/lib/modal-a11y.js";

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

test("a menu's arrow keys step and wrap round; Home and End jump; other keys are left alone", () => {
  assert.equal(menuStep("ArrowDown", 0, 3), 1);
  assert.equal(menuStep("ArrowDown", 2, 3), 0);
  assert.equal(menuStep("ArrowUp", 0, 3), 2);
  assert.equal(menuStep("Home", 2, 3), 0);
  assert.equal(menuStep("End", 0, 3), 2);
  assert.equal(menuStep("Enter", 1, 3), null);
});

test("with nothing in the menu focused, ArrowDown goes to the first item and ArrowUp to the last", () => {
  assert.equal(menuStep("ArrowDown", -1, 3), 0);
  assert.equal(menuStep("ArrowUp", -1, 3), 2);
  assert.equal(menuStep("ArrowDown", -1, 0), null);
});

test("Tab always leaves a menu; it leaves a panel only past its first or last control", () => {
  assert.equal(tabLeaves("menu", 1, 3, false), true);
  assert.equal(tabLeaves("dialog", 1, 3, false), false);
  assert.equal(tabLeaves("dialog", 2, 3, false), true);
  assert.equal(tabLeaves("dialog", 0, 3, true), true);
  assert.equal(tabLeaves("dialog", 1, 3, true), false);
  assert.equal(tabLeaves("dialog", -1, 0, false), true);
});

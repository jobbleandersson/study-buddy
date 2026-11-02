import "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { bottomClearance } from "../../js/lib/dom.js";

const r = (top, height) => ({ top, height, bottom: top + height });

describe("how high the toast rides", () => {
  test("clears the highest bar along the bottom", () => {
    // a 390 x 844 phone: the tab bar at 784 and the AI page's message box at 718
    assert.equal(bottomClearance([r(784, 60), r(718, 58)], 844), 126);
    assert.equal(bottomClearance([r(784, 60)], 844), 60);
  });
  test("a session's button bar", () => {
    assert.equal(bottomClearance([r(771, 73)], 844), 73);
  });
  test("nothing to clear, or bars that are hidden, off screen or high up the page", () => {
    assert.equal(bottomClearance([], 844), 0);
    assert.equal(bottomClearance([r(0, 0)], 844), 0, "hidden: no height");
    assert.equal(bottomClearance([r(900, 50)], 844), 0, "below the screen");
    assert.equal(bottomClearance([r(100, 60)], 844), 0, "a header, not a bottom bar");
    assert.equal(bottomClearance([null, undefined], 844), 0);
  });
});

// The home page's greeting and background both follow daypart(): no "Good morning" in the middle of the night.
import test from "node:test";
import assert from "node:assert/strict";
import { daypart } from "../../js/components/home-backdrop.js";

test("daypart splits the day at 05, 12, 18 and 22", () => {
  const at = (h) => daypart(h);
  assert.equal(at(0), "night");
  assert.equal(at(2), "night");
  assert.equal(at(4), "night");
  assert.equal(at(5), "morning");
  assert.equal(at(11), "morning");
  assert.equal(at(12), "day");
  assert.equal(at(17), "day");
  assert.equal(at(18), "evening");
  assert.equal(at(21), "evening");
  assert.equal(at(22), "night");
});

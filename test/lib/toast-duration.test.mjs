// How long a toast stays up (lib/dom.js): long enough to read, never below the base for its kind.
import test from "node:test";
import assert from "node:assert/strict";
import { toastDuration } from "../../js/lib/dom.js";

test("a short toast keeps the 2.6 s base, a toast with a button the 6 s base", () => {
  assert.equal(toastDuration("Sparat"), 2600);
  assert.equal(toastDuration("Borttaget", true), 6000);
});

test("a longer message stays longer, about 60 ms a character", () => {
  const msg = "x".repeat(100);
  assert.equal(toastDuration(msg), 1500 + 100 * 60);
  assert.ok(toastDuration(msg) > toastDuration("kort"));
});

test("never more than ten seconds, and a missing message is safe", () => {
  assert.equal(toastDuration("x".repeat(5000)), 10000);
  assert.equal(toastDuration(undefined), 2600);
});

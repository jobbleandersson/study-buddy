// lib/dom.js markIfScrolls: a box that scrolls (a wide formula, a long reading text, the activity map on a
// phone) must be focusable for a keyboard to scroll it, and one that fits must not add a Tab stop.
import test from "node:test";
import assert from "node:assert/strict";
import { markIfScrolls } from "../../js/lib/dom.js";

function fakeBox({ sw, cw, sh = 10, ch = 10 }) {
  const attrs = new Map();
  return {
    scrollWidth: sw, clientWidth: cw, scrollHeight: sh, clientHeight: ch, attrs,
    setAttribute: (k, v) => attrs.set(k, String(v)),
    removeAttribute: (k) => attrs.delete(k),
    hasAttribute: (k) => attrs.has(k),
  };
}

test("an overflowing box becomes a focusable, named region", () => {
  const box = fakeBox({ sw: 300, cw: 200 });
  assert.equal(markIfScrolls(box, "Formel: Pythagoras sats"), true);
  assert.deepEqual(Object.fromEntries(box.attrs), { tabindex: "0", role: "group", "aria-label": "Formel: Pythagoras sats" });
});

test("tall overflow counts too; a reading text is a region (a landmark), a formula only a group", () => {
  const text = fakeBox({ sw: 100, cw: 100, sh: 900, ch: 300 });
  assert.equal(markIfScrolls(text, "Texten", "region"), true);
  assert.equal(text.attrs.get("role"), "region");
});

test("a box that fits gets nothing, and loses it again once it fits", () => {
  const fits = fakeBox({ sw: 200, cw: 200 });
  assert.equal(markIfScrolls(fits, "x"), false);
  assert.equal(fits.attrs.size, 0);
  const box = fakeBox({ sw: 300, cw: 200 });
  markIfScrolls(box, "x");
  box.scrollWidth = 200;   // the window grew
  assert.equal(markIfScrolls(box, "x"), false);
  assert.equal(box.attrs.size, 0);
});

test("a pixel of rounding is not overflow", () => {
  assert.equal(markIfScrolls(fakeBox({ sw: 201, cw: 200 }), "x"), false);
});

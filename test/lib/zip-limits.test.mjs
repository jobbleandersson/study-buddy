import test from "node:test";
import assert from "node:assert/strict";
import { withinTotal } from "../../js/lib/zip-limits.js";

const MB = 1024 * 1024;
const f = (name, mb) => ({ name, size: mb * MB });
const size = (x) => x.size;

test("files are taken in order while their total fits", () => {
  const out = withinTotal([f("a", 40), f("b", 40), f("c", 40)], 100 * MB, size);
  assert.deepEqual(out.map((x) => x.name), ["a", "b"]);
});

test("a file that doesn't fit is skipped, a smaller one after it still can be taken", () => {
  const out = withinTotal([f("a", 60), f("big", 80), f("small", 20)], 100 * MB, size);
  assert.deepEqual(out.map((x) => x.name), ["a", "small"]);
});

test("twenty files each at the per-file cap don't all get through", () => {
  const files = Array.from({ length: 20 }, (_, i) => f(`p${i}`, 60));
  const out = withinTotal(files, 150 * MB, size);
  assert.equal(out.length, 2);
  assert.ok(out.reduce((n, x) => n + x.size, 0) <= 150 * MB);
});

test("a missing or odd declared size counts as 0 and never throws", () => {
  const out = withinTotal([{ name: "a" }, { name: "b", size: "x" }, f("c", 10)], 100 * MB, size);
  assert.equal(out.length, 3);
});

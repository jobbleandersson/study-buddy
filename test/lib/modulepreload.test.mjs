import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startupModules, preloadBlock, currentBlock } from "../../tools/modulepreload.mjs";

// index.html lists main.js's startup modules so a phone fetches them all at once (tools/modulepreload.mjs).
// An import added or removed without rerunning the tool would leave the list wrong: a module missing from it
// loads a round trip late again, one no longer imported is downloaded for nothing.
test("index.html's modulepreload list matches main.js's static imports", () => {
  assert.equal(currentBlock(), preloadBlock(), "run: node tools/modulepreload.mjs");
});

test("every listed startup module exists", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const missing = startupModules().filter((p) => !existsSync(root + p));
  assert.deepEqual(missing, []);
  assert.ok(startupModules().includes("js/store.js"), "store.js is a startup module");
});

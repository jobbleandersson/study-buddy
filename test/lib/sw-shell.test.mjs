import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Every module the app loads has to be in the service worker's install list. The activate step
// deletes the previous cache, so a module that isn't listed is gone offline after the next deploy —
// and a missing startup import leaves a blank page with no error screen.
const root = fileURLToPath(new URL("../../", import.meta.url));
// Not part of the app: the public practice pages' own script (served by server/, never offline).
const NOT_APP = new Set(["js/ova.js"]);

function jsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? jsFiles(p) : p.endsWith(".js") ? [p] : [];
  });
}

test("sw.js precaches every app module under js/", () => {
  const sw = readFileSync(join(root, "sw.js"), "utf8");
  const missing = jsFiles(join(root, "js"))
    .map((p) => relative(root, p).split("\\").join("/"))
    .filter((p) => !NOT_APP.has(p) && !sw.includes(`"./${p}"`));
  assert.deepEqual(missing, [], `add these to APP_SHELL in sw.js: ${missing.join(", ")}`);
});

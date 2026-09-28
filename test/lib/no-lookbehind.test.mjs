import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// A regex lookbehind assertion — (?<=...) or (?<!...) — is a SyntaxError at PARSE time on Safari
// before 16.4 (older iPhones/iPads still on iOS 15/16.3). js/ is loaded as ES modules, so ONE
// lookbehind anywhere in the import graph fails the whole app's load on those devices, not just the
// one feature that used it. This walks every .js file under js/ and fails if the syntax reappears —
// a substring check, deliberately not a JS-parsing one, so it also catches one inside a string or
// comment (still worth flagging: see js/lib/text.js and js/lib/markdown.js for how those are written
// to avoid it, by describing the syntax in prose instead of spelling it out).

const JS_DIR = fileURLToPath(new URL("../../js", import.meta.url));

function jsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...jsFiles(full));
    else if (name.endsWith(".js")) out.push(full);
  }
  return out;
}

test("no file under js/ contains a regex lookbehind assertion", () => {
  const offenders = [];
  for (const file of jsFiles(JS_DIR)) {
    const src = readFileSync(file, "utf8");
    if (/\(\?<[=!]/.test(src)) offenders.push(path.relative(JS_DIR, file).replace(/\\/g, "/"));
  }
  assert.deepEqual(offenders, [], `lookbehind syntax found in: ${offenders.join(", ")}`);
});

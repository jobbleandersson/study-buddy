import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// pdf.js 3.11 (vendor/pdf.min.js) compiles parts of a PDF into code when allowed to, which is how
// CVE-2024-4367 ran a malicious file's script in the page. Every way into it has to say no, and the
// server's CSP (server/test/general.test.mjs) has no 'unsafe-eval' to fall back on.
const root = fileURLToPath(new URL("../../js", import.meta.url));
const files = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? files(p) : p.endsWith(".js") ? [p] : [];
});

test("every pdf.js getDocument call in the app turns eval off", () => {
  const calls = [];
  for (const file of files(root)) {
    for (const m of readFileSync(file, "utf8").matchAll(/getDocument\(([^)]*)\)/g)) calls.push([file, m[1]]);
  }
  assert.ok(calls.length >= 1, "expected at least one getDocument call");
  for (const [file, args] of calls) assert.match(args, /isEvalSupported:\s*false/, `${file} calls getDocument without isEvalSupported: false`);
});

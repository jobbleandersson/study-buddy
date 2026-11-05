// CLAUDE.md: "Use colour tokens, never hex, so every theme works." tokens.css holds the colours; the other
// stylesheets carry hex literals from before that rule (mostly `color: #fff` on brand buttons and dark-theme
// overrides). Replacing them all in one go risks every theme, so this is a ratchet: the count in each file may
// only go down. A new rule that needs a colour uses a token (add one to tokens.css if none fits); when you
// remove literals, lower the number here so they can't creep back (the test says so, but only fails when a count
// goes UP: two PRs that each remove a few would otherwise conflict on the same line).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CSS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "css");

/** Hex colour literals in a stylesheet, comments left out. An #id selector made only of hex letters (#feed) would
 *  count too: rename it or add a number to BASELINE with a comment. */
function hexCount(css) {
  return (css.replace(/\/\*[\s\S]*?\*\//g, "").match(/#[0-9a-fA-F]{3,8}\b/g) || []).length;
}

// Allowed hex literals per file (tokens.css defines the palette, so it is not counted).
const BASELINE = { "app.css": 249, "design.css": 4, "landing.css": 11, "ova.css": 2, "fonts.css": 0 };

test("hexCount ignores comments and counts 3 to 8 digit colours", () => {
  assert.equal(hexCount("a { color: #fff; background: #2C5CD6; border: 1px solid #12345678 }"), 3);
  assert.equal(hexCount("/* #fff #000 */ a { color: var(--ink) }"), 0);
});

test("no stylesheet gains hex colours (use a token instead)", (t) => {
  const files = readdirSync(CSS_DIR).filter((f) => f.endsWith(".css") && f !== "tokens.css");
  for (const f of files) {
    const n = hexCount(readFileSync(path.join(CSS_DIR, f), "utf8"));
    assert.ok(f in BASELINE, `${f} is a new stylesheet: add it to BASELINE (with 0 if it uses only tokens)`);
    assert.ok(n <= BASELINE[f], `${f} has ${n} hex colours, the limit is ${BASELINE[f]}: use a colour token from tokens.css instead`);
    if (n < BASELINE[f]) t.diagnostic(`${f} is down to ${n} hex colours: lower its BASELINE from ${BASELINE[f]} to ${n} so they can't creep back`);
  }
});

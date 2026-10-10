import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import en from "../../js/lib/strings.en.js";
import sv from "../../js/lib/strings.sv.js";

const STRINGS = { en, sv };

// Object-literal syntax silently lets a duplicate key win-by-last-write, so
// Object.keys() alone can't catch it - a duplicate never shows up as a
// missing or extra key, just a value nobody notices got overwritten. This
// re-scans the raw source of each language's own file for its quoted keys.
function keysInBlock(lang) {
  const source = readFileSync(fileURLToPath(new URL(`../../js/lib/strings.${lang}.js`, import.meta.url)), "utf8");
  return [...source.matchAll(/^\s*"([^"]+)":/gm)].map((m) => m[1]);
}

test("STRINGS.en and STRINGS.sv have exactly the same keys", () => {
  const enKeys = Object.keys(STRINGS.en);
  const svKeys = Object.keys(STRINGS.sv);
  const enSet = new Set(enKeys);
  const svSet = new Set(svKeys);
  const missingInSv = enKeys.filter((k) => !svSet.has(k));
  const missingInEn = svKeys.filter((k) => !enSet.has(k));
  assert.deepEqual(missingInSv, [], "keys present in en but missing from sv");
  assert.deepEqual(missingInEn, [], "keys present in sv but missing from en");
  assert.equal(enKeys.length, svKeys.length);
});

test("neither language table has a duplicate key literal in its source", () => {
  for (const lang of ["en", "sv"]) {
    const keys = keysInBlock(lang);
    const seen = new Set();
    const dupes = [];
    for (const k of keys) {
      if (seen.has(k)) dupes.push(k);
      seen.add(k);
    }
    assert.deepEqual(dupes, [], `duplicate key(s) in STRINGS.${lang}`);
  }
});

test("every value contains only {name} placeholders (no stray unmatched braces)", () => {
  for (const lang of ["en", "sv"]) {
    for (const [key, value] of Object.entries(STRINGS[lang])) {
      const opens = (value.match(/\{/g) || []).length;
      const closes = (value.match(/\}/g) || []).length;
      assert.equal(opens, closes, `${lang}.${key} has mismatched { } in "${value}"`);
    }
  }
});

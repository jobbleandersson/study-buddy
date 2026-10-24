// Every string key written as a literal t("...") in the app must exist in both language tables. A key
// missing from them shows up on screen as the raw key ("feedback.send").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import sv from "../../js/lib/strings.sv.js";
import en from "../../js/lib/strings.en.js";

function files(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".js") && !/strings\.(sv|en)\.js$/.test(p) ? [p] : [];
  });
}

// Comments quote keys as examples (t("menu.newSet") -> "New set"), so they are dropped first.
const withoutComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

test("every literal string key used in js/ exists in Swedish and English", () => {
  const missing = [];
  for (const f of files("js")) {
    const src = withoutComments(readFileSync(f, "utf8"));
    for (const m of src.matchAll(/(?:^|[^\w.])t\(\s*"([a-zA-Z0-9_.-]+\.[a-zA-Z0-9_.-]+)"/g)) {
      for (const [lang, table] of [["sv", sv], ["en", en]]) {
        if (!(m[1] in table)) missing.push(`${f}: ${m[1]} (${lang})`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

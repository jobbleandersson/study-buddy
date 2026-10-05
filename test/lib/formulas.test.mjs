import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// The formula sheet (#/reference) is two files, data/reference/formulas.sv.json and .en.json, read
// side by side by nobody but the page. These keep them in step and keep every formula renderable,
// so an edit to one language or a typo in a LaTeX string can't quietly break the sheet.
const root = fileURLToPath(new URL("../../", import.meta.url));
const load = (lang) => JSON.parse(readFileSync(join(root, "data", "reference", `formulas.${lang}.json`), "utf8"));
const sv = load("sv");
const en = load("en");

// The vendored KaTeX is a browser bundle; run it in a sandbox that plays the window.
const sandbox = {};
sandbox.self = sandbox;
vm.runInNewContext(readFileSync(join(root, "vendor", "katex.min.js"), "utf8"), sandbox);
const katex = sandbox.katex;

function* items(data) {
  for (const s of data.sections) for (const g of s.groups) for (const it of g.items) yield { s, g, it };
}

test("formulas: Swedish and English have the same subjects, groups and formulas in the same order", () => {
  const shape = (data) => data.sections.map((s) => [s.id, s.groups.map((g) => [g.id, g.items.map((it) =>
    [it.id, it.level, (it.vars || []).length, (it.table || []).length, !!it.formula, !!it.note])])]);
  assert.deepEqual(shape(en), shape(sv));
});

test("formulas: every item has a unique id, a name, a level and something to show", () => {
  const seen = new Set();
  for (const { it } of items(sv)) {
    assert.ok(!seen.has(it.id), `duplicate id ${it.id}`);
    seen.add(it.id);
    assert.ok(it.name, `${it.id} has no name`);
    assert.ok(["hs", "gy"].includes(it.level), `${it.id} has level ${it.level}`);
    assert.ok(it.formula || it.table?.length, `${it.id} has neither a formula nor a table`);
  }
});

test("formulas: every formula, symbol and table value renders in KaTeX (both languages)", () => {
  for (const [lang, data] of [["sv", sv], ["en", en]]) {
    for (const { it } of items(data)) {
      const tex = [it.formula, ...(it.vars || []).map((v) => v[0]), ...(it.table || []).map((r) => r[2])].filter(Boolean);
      for (const src of tex) {
        assert.doesNotThrow(() => katex.renderToString(src, { throwOnError: true, strict: "error" }), `${lang} ${it.id}: ${src}`);
      }
    }
  }
});

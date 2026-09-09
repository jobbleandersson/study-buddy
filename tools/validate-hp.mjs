// Dev-only sanity check for Högskoleprovet content. Not shipped, not in
// APP_SHELL. Run from the repo root:  node tools/validate-hp.mjs
//
// Checks: choice counts per delprov, answer in range, KVA/NOG canonical
// choices, figure files exist, stimulus identical within a group, count
// matches index.json, norm tables monotonic in [0, 2.00].

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const fail = (m) => errors.push(m);

const CHOICE_COUNT = { ord: 5, las: 4, mek: 4, elf: 4, xyz: 5, kva: 4, nog: 5, dtk: 5 };
const KVA_CHOICES = [
  "Kvantitet I är större",
  "Kvantitet II är större",
  "Kvantitet I och II är lika stora",
  "Informationen är otillräcklig",
];
const NOG_CHOICES = [
  "(1) ensam är tillräcklig men inte (2) ensam",
  "(2) ensam är tillräcklig men inte (1) ensam",
  "(1) och (2) tillsammans är tillräckliga men inte var för sig",
  "(1) respektive (2) ensam är tillräcklig",
  "(1) och (2) tillsammans är inte tillräckliga",
];

const index = JSON.parse(readFileSync(join(ROOT, "data/library/index.json"), "utf8"));
const hpSets = index.sets.filter((s) => /^lib-hp-/.test(s.id));
if (!hpSets.length) fail("no lib-hp-* sets in index.json");

for (const entry of hpSets) {
  const path = join(ROOT, entry.file);
  if (!existsSync(path)) { fail(`${entry.id}: file missing ${entry.file}`); continue; }
  let doc;
  try { doc = JSON.parse(readFileSync(path, "utf8")); }
  catch (e) { fail(`${entry.id}: bad JSON — ${e.message}`); continue; }

  if (doc.id !== entry.id) fail(`${entry.id}: doc.id is "${doc.id}"`);
  if ((doc.questions || []).length !== entry.count) {
    fail(`${entry.id}: index count ${entry.count} != ${doc.questions.length} questions`);
  }

  const groups = {};
  for (const q of doc.questions || []) {
    const tag = `${entry.id}/${q.id}`;
    if (q.kind !== "mc") { fail(`${tag}: kind is "${q.kind}", expected mc`); continue; }
    const want = CHOICE_COUNT[q.variant];
    if (!want) { fail(`${tag}: unknown variant "${q.variant}"`); continue; }
    if (!Array.isArray(q.choices) || q.choices.length !== want) {
      fail(`${tag}: ${q.variant} needs ${want} choices, has ${q.choices?.length}`);
    }
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= (q.choices?.length || 0)) {
      fail(`${tag}: answer ${q.answer} out of range`);
    }
    if (q.variant === "kva" && JSON.stringify(q.choices) !== JSON.stringify(KVA_CHOICES)) {
      fail(`${tag}: KVA choices are not the canonical set`);
    }
    if (q.variant === "nog" && JSON.stringify(q.choices) !== JSON.stringify(NOG_CHOICES)) {
      fail(`${tag}: NOG choices are not the canonical set`);
    }
    if (q.variant === "kva" && !(q.stimulus && Array.isArray(q.stimulus.quantities) && q.stimulus.quantities.length === 2)) {
      fail(`${tag}: KVA needs stimulus.quantities [I, II]`);
    }
    if (q.variant === "nog" && !(q.stimulus && Array.isArray(q.stimulus.statements) && q.stimulus.statements.length >= 2)) {
      fail(`${tag}: NOG needs stimulus.statements`);
    }
    if (q.variant === "dtk" && !(q.figure && q.figure.src && q.figure.alt)) {
      fail(`${tag}: DTK needs figure { src, alt }`);
    }
    if (q.figure && q.figure.src) {
      const fp = join(ROOT, "data/library/figures", q.figure.src);
      if (!existsSync(fp)) fail(`${tag}: figure file missing ${q.figure.src}`);
      if (!q.figure.alt) fail(`${tag}: figure has no alt text`);
    }
    if (q.stimulus && q.stimulus.id) {
      (groups[q.stimulus.id] ||= []).push(JSON.stringify(q.stimulus));
    }
  }
  for (const [gid, list] of Object.entries(groups)) {
    if (new Set(list).size !== 1) fail(`${entry.id}: stimulus "${gid}" differs between its questions`);
  }
}

// norm tables — load hp.js as a module
const hp = await import(join(ROOT, "js/lib/hp.js"));
for (const [id, table] of Object.entries(hp.NORM_TABLES)) {
  for (const part of ["verbal", "kvant"]) {
    const arr = table[part];
    if (!Array.isArray(arr) || arr.length !== hp.PART_MAX + 1) {
      fail(`NORM_TABLES.${id}.${part}: length ${arr?.length}, expected ${hp.PART_MAX + 1}`);
      continue;
    }
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] < arr[i - 1]) fail(`NORM_TABLES.${id}.${part}: not monotonic at raw ${i}`);
    }
    if (arr[0] < 0 || arr[arr.length - 1] > 2) fail(`NORM_TABLES.${id}.${part}: outside [0, 2.00]`);
  }
}

if (errors.length) {
  console.error(`\n✗ ${errors.length} problem(s):\n` + errors.map((e) => "  - " + e).join("\n") + "\n");
  process.exit(1);
}
console.log("✓ Högskoleprovet content OK (" + hpSets.length + " sets)");

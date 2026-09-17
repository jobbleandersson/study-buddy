// Dev-only sanity check for the curriculum practice library. Not shipped, not
// in APP_SHELL. Run from the repo root:
//   node tools/validate-library.mjs            structure + sv/en parity
//   node tools/validate-library.mjs --target=15  also list sets below 15 questions
//
// Checks: index count matches the file, doc id matches the index, every set
// has an English file with the same question ids in the same order, the same
// kind and (for mc) the same correct answer index and number of choices;
// question ids unique across the library; mc has 3–5 distinct choices and an
// answer in range; text/worked/flashcard have an answer; worked has steps;
// every non-flashcard question explains itself (explanation or steps).

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const fail = (m) => errors.push(m);
const targetArg = process.argv.find((a) => a.startsWith("--target="));
const target = targetArg ? Number(targetArg.split("=")[1]) : 0;

const KINDS = new Set(["mc", "text", "cloze", "flashcard", "worked"]);
// Case-sensitive on purpose: spelling questions offer options that differ only
// in capitals ("jordgubbstårta" / "Jordgubbstårta", "F(b)" / "f(b)").
const norm = (s) => String(s ?? "").trim().replace(/\s+/g, " ");

const index = JSON.parse(readFileSync(join(ROOT, "data/library/index.json"), "utf8"));
const allIds = new Map();
const below = [];
let questions = 0;

function load(path, tag) {
  if (!existsSync(path)) { fail(`${tag}: file missing ${path.replace(ROOT, "")}`); return null; }
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (e) { fail(`${tag}: bad JSON — ${e.message}`); return null; }
}

function checkQuestion(q, tag) {
  if (!q.id) fail(`${tag}: question without id`);
  if (!KINDS.has(q.kind)) fail(`${tag}: unknown kind "${q.kind}"`);
  if (!String(q.prompt || "").trim()) fail(`${tag}: empty prompt`);
  if (!String(q.topic || "").trim()) fail(`${tag}: no topic`);
  if (q.kind === "mc") {
    const c = q.choices;
    if (!Array.isArray(c) || c.length < 3 || c.length > 5) fail(`${tag}: mc needs 3–5 choices, has ${c?.length}`);
    else if (new Set(c.map(norm)).size !== c.length) fail(`${tag}: duplicate choices`);
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= (c?.length || 0)) fail(`${tag}: answer ${q.answer} out of range`);
    if (!String(q.explanation || "").trim()) fail(`${tag}: mc without explanation`);
  } else if (q.kind !== "cloze") {
    if (!String(q.answer || "").trim()) fail(`${tag}: ${q.kind} without answer`);
  }
  if (q.kind === "worked" && !(Array.isArray(q.steps) && q.steps.length >= 2)) fail(`${tag}: worked needs at least 2 steps`);
}

for (const entry of index.sets) {
  const sv = load(join(ROOT, entry.file), entry.id);
  const en = load(join(ROOT, entry.file.replace(/^data\/library\//, "data/library-en/")), `${entry.id} (en)`);
  if (!sv) continue;

  if (sv.id !== entry.id) fail(`${entry.id}: doc.id is "${sv.id}"`);
  const qs = sv.questions || [];
  questions += qs.length;
  if (qs.length !== entry.count) fail(`${entry.id}: index count ${entry.count} != ${qs.length} questions`);
  if (target && qs.length < target) below.push(`${entry.id} (${qs.length})`);

  for (const q of qs) {
    const tag = `${entry.id}/${q.id}`;
    if (allIds.has(q.id)) fail(`${tag}: id also used in ${allIds.get(q.id)}`);
    allIds.set(q.id, entry.id);
    checkQuestion(q, tag);
  }

  if (!en) continue;
  if (en.id !== entry.id) fail(`${entry.id} (en): doc.id is "${en.id}"`);
  const eq = en.questions || [];
  if (eq.map((q) => q.id).join("|") !== qs.map((q) => q.id).join("|")) {
    fail(`${entry.id}: sv and en question ids differ (sv ${qs.length}, en ${eq.length})`);
    continue;
  }
  eq.forEach((e, i) => {
    const s = qs[i];
    const tag = `${entry.id}/${e.id} (en)`;
    checkQuestion(e, tag);
    if (e.kind !== s.kind) fail(`${tag}: kind "${e.kind}" but sv is "${s.kind}"`);
    if (s.kind === "mc") {
      if (e.answer !== s.answer) fail(`${tag}: answer ${e.answer} but sv is ${s.answer}`);
      if ((e.choices?.length || 0) !== (s.choices?.length || 0)) fail(`${tag}: ${e.choices?.length} choices but sv has ${s.choices?.length}`);
    }
  });
}

if (target) {
  console.log(below.length
    ? `${below.length} of ${index.sets.length} sets below ${target} questions`
    : `all ${index.sets.length} sets have at least ${target} questions`);
}
if (errors.length) {
  console.error(`\n✗ ${errors.length} problem(s):\n` + errors.map((e) => "  - " + e).join("\n") + "\n");
  process.exit(1);
}
console.log(`✓ Library OK (${index.sets.length} sets, ${questions} questions, sv + en)`);

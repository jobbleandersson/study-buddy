// Dev-only sanity check for the curriculum practice library. Not shipped, not
// in APP_SHELL. Run from the repo root:
//   node tools/validate-library.mjs            structure + sv/en parity
//   node tools/validate-library.mjs --target=15  also list sets below 15 questions
//   node tools/validate-library.mjs --update-length-baseline  lock in an improved answer-length ratio (see below)
//
// Checks: index count matches the file, doc id matches the index, every set
// has an English file with the same question ids in the same order, the same
// kind and (for mc) the same correct answer index and number of choices;
// question ids unique across the library; mc has 3–5 distinct choices and an
// answer in range; text/worked/flashcard have an answer; worked has steps;
// every non-flashcard question explains itself (explanation or steps); every
// question's topic is in its set's topics list (per-topic class stats and
// mastery group by that list, so a missing one drops those questions from them).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
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

// How many multiple-choice questions (3+ options) have the correct option as the single longest one.
const LENGTH_BASELINE_FILE = join(ROOT, "tools/answer-length-baseline.json");
const NEW_SET_MAX_LONGEST_SHARE = 0.35;
const lengthBaseline = existsSync(LENGTH_BASELINE_FILE) ? JSON.parse(readFileSync(LENGTH_BASELINE_FILE, "utf8")) : {};
const lengthNow = {};
function longestKeyCount(doc) {
  let mc = 0, longest = 0;
  for (const q of doc.questions || []) {
    if (q.kind !== "mc" || !Array.isArray(q.choices) || q.choices.length < 3 || !Number.isInteger(q.answer)) continue;
    mc++;
    const len = q.choices.map((c) => String(c).trim().length);
    const max = Math.max(...len);
    if (len[q.answer] === max && len.filter((n) => n === max).length === 1) longest++;
  }
  return { mc, longest };
}

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

  const checkTopics = (doc, suffix) => {
    const topics = new Set(doc.topics || []);
    for (const q of doc.questions || []) {
      if (q.topic && !topics.has(q.topic)) fail(`${entry.id}/${q.id}${suffix}: topic "${q.topic}" isn't in the set's topics`);
    }
  };

  for (const q of qs) {
    const tag = `${entry.id}/${q.id}`;
    if (allIds.has(q.id)) fail(`${tag}: id also used in ${allIds.get(q.id)}`);
    allIds.set(q.id, entry.id);
    checkQuestion(q, tag);
  }
  checkTopics(sv, "");
  lengthNow[entry.id] = longestKeyCount(sv);

  if (!en) continue;
  if (en.id !== entry.id) fail(`${entry.id} (en): doc.id is "${en.id}"`);
  checkTopics(en, " (en)");
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

// The ratchet: a set may not have a higher share of 'longest option is the key' than its baseline.
const update = process.argv.includes("--update-length-baseline");
const nextBaseline = { ...lengthBaseline };
for (const [id, now] of Object.entries(lengthNow)) {
  if (now.mc < 8) continue;   // too few questions to say anything
  const base = lengthBaseline[id];
  if (update) {   // a deliberate act: lock in an improvement, or record a new set as it is; a baseline never goes up
    if (!base || now.longest / now.mc < base.longest / base.mc) nextBaseline[id] = now;
    continue;
  }
  const allowed = base ? Math.ceil((base.longest / base.mc) * now.mc - 1e-9) : Math.floor(NEW_SET_MAX_LONGEST_SHARE * now.mc);
  if (now.longest > allowed) {
    fail(`${id}: the correct option is the single longest in ${now.longest} of ${now.mc} questions (${Math.round((100 * now.longest) / now.mc)} %), ${base ? `baseline ${Math.round((100 * base.longest) / base.mc)} %` : `a new set may have at most ${Math.round(NEW_SET_MAX_LONGEST_SHARE * 100)} %`} - lengthen the distractors or shorten the key (node tools/validate-library.mjs --update-length-baseline records an improvement)`);
  }
}
if (update) {
  writeFileSync(LENGTH_BASELINE_FILE, JSON.stringify(Object.fromEntries(Object.entries(nextBaseline).sort(([a], [b]) => (a < b ? -1 : 1))), null, 1) + "\n");
  console.log("answer-length baseline updated");
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

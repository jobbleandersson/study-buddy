// More Högskoleprov questions, written by the AI in a delprov's real format: as many options as the
// test has (KVA's and NOG's fixed options word for word), in Swedish, with worked steps. They go into
// one set per delprov, "lib-hp-<dp>-ai", which the delprov page, practice runs, the mini-mock and the
// prognosis all read like any other HP set — and every question in it is shown as "AI-skapad".
//
// Only the delprov whose questions stand on their own: LÄS and ELF need whole texts and DTK needs
// figures, which a generated question can't be trusted to get right.

import { store } from "../store.js";
import { uid } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { generateAssignment } from "../claude.js";
import { newQuestionsOnly } from "../lib/exam.js";
import { OPTION_COUNT, isHpSetId, parseHpSetId } from "../lib/hp.js";

export const AI_DELPROV = ["ord", "mek", "xyz", "kva", "nog"];
export const MORE_HP = 10;
export const aiSetId = (dp) => `lib-hp-${dp}-ai`;

const FORMAT = {
  ord: "ORD: the prompt is a single Swedish word (or short expression); the five options are single words or short phrases, exactly one closest in meaning.",
  mek: "MEK: the prompt is one or two Swedish sentences with one to three gaps written as ______; each of the four options fills every gap (several words separated by \" – \"), exactly one fits in meaning and grammar.",
  xyz: "XYZ: a self-contained maths problem (arithmetic, algebra, geometry, functions, statistics) solvable without a calculator; four options, numeric or algebraic, written with $…$ for maths.",
  kva: "KVA: put the two quantities in stimulus.quantities as two strings, any shared information in the prompt; the options are exactly the four fixed KVA options below, in that order.",
  nog: "NOG: a question in the prompt and the two statements in stimulus.statements as two strings; the options are exactly the five fixed NOG options below, in that order.",
};

const running = new Map();   // delprov -> the batch being written

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Writes up to `count` new questions for a delprov and adds them to its AI set. Resolves how many
 *  were added; throws (a ClaudeError or Error) when none came out usable. */
export function addHpQuestions(dp, count = MORE_HP) {
  if (running.has(dp)) return running.get(dp);
  const p = addNow(dp, count).finally(() => running.delete(dp));
  running.set(dp, p);
  return p;
}

export const isAddingHp = (dp) => running.has(dp);

async function addNow(dp, count) {
  if (!AI_DELPROV.includes(dp)) throw new Error(t("hp.moreNotHere"));
  const sets = store.assignments.filter((a) => isHpSetId(a.id) && parseHpSetId(a.id).delprov === dp);
  const ofDp = (list) => list.flatMap((a) => a.questions).filter((q) => (q.variant || dp) === dp && q.kind === "mc");
  // The examples are always the hand-written practice-test questions (a random 8 each time, for
  // variety) — never earlier AI ones, or each batch would copy the last and drift.
  const own = ofDp(sets.filter((a) => a.id !== aiSetId(dp)));
  const seed = shuffle(own).slice(0, 8).map(({ prompt, choices, answer, explanation, steps, stimulus, topic }) =>
    ({ kind: "mc", topic, prompt, choices, answer, explanation, steps, stimulus }));
  if (!seed.length) throw new Error(t("hp.moreNoSeed"));
  const fixed = dp === "kva" || dp === "nog" ? seed[0].choices : null;

  // Some of a batch can fail the format check or repeat a question, so a short batch gets one
  // top-up for the rest. A failed top-up keeps what the first round gave.
  const fresh = await writeBatch({ dp, count, seed, fixed, sets, ofDp });
  if (!fresh.length) throw new Error(t("hp.moreFailed"));
  if (fresh.length < count) {
    try {
      fresh.push(...await writeBatch({ dp, count: count - fresh.length, seed, fixed, sets: [...sets, { questions: fresh }], ofDp }));
    } catch { /* keep the first round */ }
  }
  const added = fresh.slice(0, count);

  const existing = store.getAssignment(aiSetId(dp));
  if (existing) {
    store.updateAssignment(existing.id, { questions: [...existing.questions, ...added] });
  } else {
    const subject = store.subjects.find((s) => s.id === sets[0]?.subjectId)?.name || t(`hp.name.${dp}`);
    store.addAssignmentDoc({ id: aiSetId(dp), subject, type: "assignment", title: t("hp.aiSetTitle", { delprov: t(`hp.delprov.${dp}`) }), questions: added });
  }
  return added.length;
}

/** One request to the AI for `count` questions; returns the ones that pass the format check and
 *  aren't already in `sets`. */
async function writeBatch({ dp, count, seed, fixed, sets, ofDp }) {
  // What already exists, AI-made included, so nothing is written twice with new numbers.
  const taken = ofDp(sets).map((q) => String(q.prompt).replace(/\s+/g, " ").slice(0, 90));

  const gen = await generateAssignment({
    task: "generateHp",   // the strong model: see MODELS in claude.js
    count,
    moreLike: { title: t(`hp.name.${dp}`), subject: `Högskoleprovet – ${dp.toUpperCase()}`, questions: seed },
    extraRules: [
      "These are practice questions for the Swedish Högskoleprovet, in the real test's format. Write everything in Swedish.",
      FORMAT[dp],
      `Every question is kind "mc" with exactly ${OPTION_COUNT[dp]} options in "choices" and the 0-based index of the right one in "answerIndex".`,
      fixed ? `The fixed options, word for word: ${JSON.stringify(fixed)}` : null,
      "Give each question an \"explanation\" (one or two sentences) and \"steps\" (2–4 short steps that reach the answer).",
      "Match the real test's spread of difficulty, not just the examples: about a third straightforward, a third that need two or three steps, and a third hard ones where a tempting wrong option catches a common mistake. Vary the problem types and settings; do not reuse an example's structure with new numbers.",
      `These questions already exist — do not repeat or rephrase any of them:\n${taken.map((p) => `- ${p}`).join("\n")}`,
      "Check every answer before you write it: exactly one option may be right.",
    ].filter(Boolean).join("\n"),
  });

  const good = [];
  for (const q of gen.questions || []) {
    if (q.kind !== "mc" || !Array.isArray(q.choices) || !(q.answer >= 0) || !q.prompt) continue;
    const right = String(q.choices[q.answer] ?? "").trim();
    let out = { ...q, id: uid(), variant: dp };
    if (fixed) {
      // Back into the fixed order (generation shuffles options), matched by the right option's text.
      const at = fixed.findIndex((c) => c.trim() === right);
      if (at < 0) continue;
      out = { ...out, choices: fixed.slice(), answer: at };
      const s = q.stimulus || {};
      const pair = dp === "kva" ? s.quantities : s.statements;
      if (!Array.isArray(pair) || pair.length !== 2 || !pair.every((x) => typeof x === "string" && x.trim())) continue;
      out.stimulus = dp === "kva" ? { quantities: pair } : { statements: pair };
    } else {
      if (q.choices.length !== OPTION_COUNT[dp]) continue;
      delete out.stimulus;
    }
    good.push(out);
  }
  return newQuestionsOnly(good, sets);
}

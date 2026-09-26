// Reading passages that several questions share. Many sets (library reading sets, and anything an
// AI or a student wrote the same way) put the text inside the first question's prompt and then ask
// follow-ups that begin "Samma text." / "Same text." - so from the second question on, the student
// could not see the text and the tutor never received it. This works out which text a question is
// about. Pure - no DOM, store or i18n.
//
// Högskoleprovet sets do it properly, with a `stimulus` on every question; stimulusText() covers
// those for the tutor.

const TEXT_WORD = "(?:texten|the\\s+(?:text|passage|message|letter|extract)|den\\s+Text|le\\s+texte|el\\s+texto)";
// "Samma text." / "Same text." / "Läs texten igen." / "Read the text (see above)." - a follow-up that says outright
// that it is about the text already shown.
const FOLLOW = new RegExp(
  "^\\s*(?:(?:Samma|Same)\\s+(?:text|brev|meddelande|stycke|utdrag|passage|message|letter|extract|excerpt)\\b"
  + `|(?:Läs|Read|Lies|Lisez|Lee)\\s+${TEXT_WORD}\\s+(?:igen|again|noch\\s+einmal|encore|otra\\s+vez)\\b`
  + `|(?:Läs|Read)\\s+${TEXT_WORD}\\s*\\((?:se|see)\\s+(?:ovan|above|föregående|previous)[^)]*\\))`,
  "i",
);
// Quietly refers to "the text" without saying "same text" - only trusted after an explicit follow-up.
const MENTIONS_TEXT = /\b(?:texten|textens|enligt\s+texten|the\s+text|the\s+passage|according\s+to\s+the|el\s+texto|der\s+Text|le\s+texte)\b/i;
const CONTINUE = /^\s*(?:Fortsättning|Continuation|Continued)\b/i;
// "<intro>: "<the text>"" then a blank line and the question itself.
const OPENER = /^([^"“]{0,120}?)["“]([\s\S]{40,}?)["”]\s*\n\s*\n[\s\S]+$/;

/** For each question, the text it depends on that is NOT already in its own prompt (or null).
 *  `questions` is a set's questions in their written order. */
export function derivePassages(questions) {
  const out = [];
  let passage = "";
  let sawFollow = false;   // the current text has already had an explicit "same text" question
  for (const q of questions || []) {
    const prompt = String(q?.prompt ?? "");
    if (FOLLOW.test(prompt)) { out.push(passage || null); if (passage) sawFollow = true; continue; }
    const m = q?.stimulus ? null : OPENER.exec(prompt);
    if (!m) {
      // "... enligt texten?" in the middle of a run of follow-ups is about that text too.
      out.push(sawFollow && passage && !q?.stimulus && !/["“]/.test(prompt) && MENTIONS_TEXT.test(prompt) ? passage : null);
      continue;
    }
    const text = m[2].trim();
    if (CONTINUE.test(m[1])) {
      // A continuation carries its own new part; the earlier part is what is missing from the screen.
      out.push(passage || null);
      passage = passage ? `${passage}\n\n${text}` : text;
    } else {
      out.push(null);
      passage = text;
      sawFollow = false;
    }
  }
  return out;
}

const cache = new WeakMap();

/** The shared text for one question of `assignment`, or null. Questions with their own `stimulus`
 *  (Högskoleprovet) are left to that, so this returns null for them. */
export function passageFor(assignment, question) {
  const list = assignment?.questions;
  if (!Array.isArray(list) || !question || question.stimulus) return null;
  let derived = cache.get(list);
  if (!derived || derived.length !== list.length) { derived = derivePassages(list); cache.set(list, derived); }
  const i = list.findIndex((q) => q?.id === question.id);
  return i >= 0 ? derived[i] : null;
}

/** A question's `stimulus` (passage, KVA columns, NOG statements) and figure as plain text for the tutor. */
export function stimulusText(question) {
  const s = question?.stimulus;
  const parts = [];
  if (s) {
    if (s.body) parts.push([s.title, s.body].filter(Boolean).join("\n"));
    if (Array.isArray(s.quantities)) parts.push(`Quantity I: ${s.quantities[0] ?? ""}\nQuantity II: ${s.quantities[1] ?? ""}${s.given ? `\nGiven: ${s.given}` : ""}`);
    if (Array.isArray(s.statements)) parts.push(s.statements.join("\n"));
  }
  if (question?.figure?.alt) parts.push(`Figure: ${question.figure.alt}`);
  return parts.join("\n\n").trim();
}

/** Everything the student can read besides the prompt itself: the question's own stimulus/figure, or the
 *  text shared from an earlier question. Empty string when there is none. */
export function passageContext(assignment, question) {
  return stimulusText(question) || passageFor(assignment, question) || "";
}

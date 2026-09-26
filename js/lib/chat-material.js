// Study material attached to a Studify AI chat: one of the student's own sets (or a text file / PDF)
// turned into a block of text the assistant answers from. Pure - no DOM, store or i18n.
//
// The set's questions are numbered F1, F2, ... and the assistant is asked to cite them as [F4]; the
// page strips those markers from the reply and shows them as "fråga 4" tags instead.

/** Characters of material sent with every message. Each one is paid for on every turn of the chat,
 *  and a student's monthly AI allowance is finite, so this is a page or two of notes - not a book. */
export const MATERIAL_MAX_CHARS = 8000;

const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

function answerOf(q) {
  if (q.kind === "mc" && Array.isArray(q.choices)) {
    const c = q.choices[q.answer];
    return c == null ? "" : String(c);
  }
  return q.kind === "cloze" || q.answer == null ? "" : String(q.answer);
}

function questionLine(q, n) {
  const prompt = q.kind === "cloze"
    ? String(q.prompt || "").replace(/\{\{([^}|]*)(?:\|[^}]*)?\}\}/g, "$1")
    : String(q.prompt || "");
  const parts = [`F${n}${q.topic ? ` (${oneLine(q.topic)})` : ""}: ${oneLine(prompt)}`];
  const answer = oneLine(answerOf(q));
  if (answer) parts.push(`Svar: ${answer}`);
  if (q.explanation) parts.push(`Förklaring: ${oneLine(q.explanation)}`);
  return parts.join(" | ");
}

/** A set as chat material. `used` is how many questions fit, so the page never shows a reference
 *  to a question the assistant did not see. */
export function materialFromSet(assignment, max = MATERIAL_MAX_CHARS) {
  const questions = Array.isArray(assignment?.questions) ? assignment.questions : [];
  const head = [oneLine(assignment?.title), oneLine(assignment?.sourceSummary)].filter(Boolean).join("\n");
  const topics = [...new Set(questions.map((q) => oneLine(q.topic)).filter(Boolean))];
  let text = head + (topics.length ? `\nÄmnen: ${topics.join(", ")}` : "") + "\n\n";
  let used = 0;
  for (const q of questions) {
    const line = `${questionLine(q, used + 1)}\n`;
    if (text.length + line.length > max) break;
    text += line;
    used += 1;
  }
  return { kind: "set", id: assignment?.id || null, title: oneLine(assignment?.title), count: questions.length, used, text: text.trim() };
}

/** Text the student uploaded or pasted. */
export function materialFromText(name, raw, max = MATERIAL_MAX_CHARS) {
  const clean = String(raw ?? "").replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return { kind: "file", id: null, title: oneLine(name), count: 0, used: 0, text: clean.slice(0, max), cut: clean.length > max };
}

/** The part of the system prompt that carries the material. Empty when nothing is attached. */
export function materialSystemBlock(material) {
  if (!material?.text) return "";
  const isSet = material.kind === "set";
  return [
    "",
    "",
    `The student has attached study material${material.title ? ` ("${material.title}")` : ""}. Answer from it; it is between the <material> tags below.`,
    isSet
      ? "It is one of their own question sets: each numbered item is a question with its answer and explanation. Right after any sentence that rests on an item, add a reference in exactly this form: [F4] (several are fine: [F4][F7]). Only use numbers that exist in the material. Never write out the whole list, and never reveal an answer the student has not tried to give in quiz-style modes."
      : "It is text the student uploaded or pasted. Do not quote long passages back.",
    "If the answer is not in the material, say so in one short sentence, then answer from general knowledge and make clear that part is not from their material.",
    "In modes that ask questions (quiz, debate), take the topics and facts from the material.",
    "<material>",
    material.text,
    "</material>",
  ].join("\n");
}

/** Pulls the [F4] markers out of a reply. `maxRef` drops numbers outside the material. A marker
 *  that is still being streamed ("[F" or "[F1") is hidden too, so it never flashes on screen. */
export function extractSourceRefs(text, maxRef = Infinity) {
  const refs = new Set();
  const cleaned = String(text ?? "")
    .replace(/\s?\[F(\d{1,3})\]/g, (_, n) => { if (Number(n) >= 1 && Number(n) <= maxRef) refs.add(Number(n)); return ""; })
    .replace(/\s?\[F?\d*$/, "");
  return { text: cleaned, refs: [...refs].sort((a, b) => a - b) };
}

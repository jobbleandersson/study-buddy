// Which option a model-written multiple-choice question says is right.
//
// The generator prompt asks for `answerIndex` (a 0-based number), but the same prompt asks for `answer`
// (text) on every other kind of question, so models now and then write the right option as its text
// ("Paris"), a letter ("C", "c)") or a number in quotes ("1") instead. The old code read a missing or
// non-numeric index as 0 and so keyed the FIRST option as correct without noticing, and the set was then
// practised again and again with a wrong key. Anything that cannot be read with confidence is now -1,
// which makes the caller drop the question (a shorter set is better than a wrong key).

const LETTERS = "ABCDEFGHIJ";

/** The 0-based index of the correct option in `choices` (an array of strings), or -1 if the question
 *  does not say clearly. `q` is the model's question object. */
export function resolveMcAnswer(q, choices) {
  const inRange = (i) => Number.isInteger(i) && i >= 0 && i < choices.length;
  if (inRange(q?.answerIndex)) return q.answerIndex;

  const a = q?.answer;
  if (typeof a === "number") return inRange(a) ? a : -1;
  if (typeof a !== "string") return -1;

  const text = a.trim();
  if (!text) return -1;
  // The answer written out in full: exact, ignoring case and surrounding spaces. Tried before letters
  // so an option that is itself just "B" still means that option.
  const same = choices.map((c) => c.trim().toLowerCase());
  const byText = same.indexOf(text.toLowerCase());
  if (byText >= 0) return byText;
  // A number in quotes counts as the 0-based index the prompt asked for.
  if (/^\d+$/.test(text)) return inRange(Number(text)) ? Number(text) : -1;
  // A letter, alone or as "C)", "c.", "(C)", "Option C".
  const letter = text.match(/^(?:option\s+|alternativ\s+|svar\s+)?\(?([A-Ja-j])[).:]?$/i);
  if (letter) {
    const i = LETTERS.indexOf(letter[1].toUpperCase());
    return inRange(i) ? i : -1;
  }
  return -1;
}

// What a question says when it is read aloud, as short separate pieces of text. Pure (no DOM, store or
// i18n) because two places must agree to the letter: the browser, which asks for the audio of each piece,
// and the server, which only voices a piece it can find in the library (server/src/voice.js). A piece is
// looked up by the SHA-256 of its text, so the student's device never sends the text itself.
//
// Why pieces and not one passage: the options are shuffled when a session starts (choices.js), so the
// audio of "A. x. B. y." recorded from the library's order would read the wrong option under each letter.
// With the letter and each option as pieces of their own, the browser plays them in the order shown.

/** Flatten markdown / LaTeX / cloze markup to something that reads as speech. */
export function toSpeakable(text) {
  return String(text || "")
    .replace(/!?\[([^\]\n]*)\]\((?:[^()\s]|\([^()\s]*\))+\)/g, "$1")   // link or picture -> its words
    .replace(/\{\{([^}|]*)(?:\|[^}]*)?\}\}/g, " $1 ")   // cloze -> first alternative
    .replace(/\$\$?([^$]*)\$\$?/g, " $1 ")               // math -> inner text
    .replace(/`([^`]*)`/g, "$1")
    .replace(/[#*_>~\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F"];
/** The spoken label of an option: the letter, or its number past F. */
export const optionLabel = (i) => `${OPTION_LETTERS[i] || i + 1}.`;

/**
 * The pieces of a question, in the order they are read: the framing material of a högskoleprov question,
 * the prompt (a cloze with "blank" said for each gap), then for multiple choice each option as a label
 * piece and a text piece. `tr(key)` gives the interface strings ("lucka", "Kvantitet I", ...).
 * Empty pieces are left out.
 */
export function questionPieces(q, tr = (k) => k) {
  if (!q) return [];
  const out = [];
  const add = (s) => { const x = toSpeakable(s); if (x) out.push(x); };

  const s = q.stimulus;
  if (s && s.body) {
    if (s.title) add(`${s.title}.`);
    add(s.body);
  } else if (s && Array.isArray(s.quantities)) {
    add(`${tr("hp.kvaColI")}: ${toSpeakable(s.quantities[0] || "")}.`);
    add(`${tr("hp.kvaColII")}: ${toSpeakable(s.quantities[1] || "")}.`);
    if (s.given) add(`${tr("hp.kvaGivenLabel")} ${toSpeakable(s.given)}.`);
  } else if (s && Array.isArray(s.statements)) {
    s.statements.forEach((l, i) => add(`(${i + 1}) ${toSpeakable(String(l).replace(/^\(\d+\)\s*/, ""))}.`));
  }
  if (q.figure && q.figure.alt) add(`${tr("hp.speakFigure")}: ${toSpeakable(q.figure.alt)}.`);

  if (q.kind === "cloze") {
    add(String(q.prompt || "").replace(/\{\{[^}]*\}\}/g, ` ${tr("q.readBlankWord")} `));
    return out;
  }
  add(q.prompt);
  if (q.kind === "mc" && Array.isArray(q.choices)) {
    q.choices.forEach((c, i) => { add(optionLabel(i)); add(c); });
  }
  return out;
}

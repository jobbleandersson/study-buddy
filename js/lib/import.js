// Parse a Quizlet / Anki / spreadsheet export into flashcards. The common
// shapes: one card per line, term and definition split by a tab, a comma, or
// " - " / " – ". Quizlet's "copy text" uses tab between and newline (or a
// custom separator) between cards.

const COL_SEPS = [
  ["\t", /\t/],
  [",", /\s*,\s*/],
  [";", /\s*;\s*/],
  [" - ", /\s+[-–—]\s+/],
];

/** Guess the column separator from the first few non-empty lines. */
function pickSep(lines) {
  for (const [, re] of COL_SEPS) {
    const hits = lines.filter((l) => re.test(l)).length;
    if (hits >= Math.max(1, Math.floor(lines.length * 0.6))) return re;
  }
  return null;
}

/**
 * parseCards(text) -> [{ term, definition }]
 * Returns [] when nothing parseable is found.
 */
export function parseCards(text) {
  const raw = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (!raw) return [];

  let lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);

  // Quizlet custom "cards separated by \n\n" — collapse pairs of lines.
  if (lines.length && !pickSep(lines.slice(0, 8))) {
    const pairs = [];
    for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([lines[i], lines[i + 1]]);
    if (pairs.length) return pairs.map(([term, definition]) => ({ term, definition }));
  }

  const sep = pickSep(lines.slice(0, 8));
  if (!sep) return [];

  const out = [];
  for (const line of lines) {
    const parts = line.split(sep);
    if (parts.length < 2) continue;
    const term = parts[0].trim();
    const definition = parts.slice(1).join(", ").trim();
    if (term && definition) out.push({ term, definition });
  }
  return out;
}

/** Build a set doc (kind:"flashcard") straight from parsed cards. */
export function cardsToDoc(cards, { title, subject }) {
  return {
    title: title || "Imported cards",
    subject: subject || "General",
    type: "assignment",
    sourceSummary: "",
    topics: ["imported"],
    questions: cards.map((c) => ({
      kind: "flashcard",
      topic: "imported",
      prompt: c.term,
      answer: c.definition,
    })),
  };
}

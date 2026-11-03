// Parse a Quizlet / Anki / spreadsheet export into flashcards. The common
// shapes: one card per line, term and definition split (at the first one only) by a tab, " - ", a
// semicolon, ": " or a comma, or a quoted spreadsheet row. Quizlet's "copy text" uses tab between and newline (or a
// custom separator) between cards.

// In order of preference when several fit: " - " and ": " before the comma, so a definition with a comma
// in it ("växter, ljus och vatten") isn't cut there. ": " needs the space, so a time like 10:30 isn't one.
const COL_SEPS = [
  ["\t", /\t/],
  [" - ", /\s+[-–—]\s+/],
  [";", /\s*;\s*/],
  [": ", /\s*:\s+/],
  [",", /\s*,\s*/],
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
  const raw = String(text || "").replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
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
    const pair = splitFirst(line, sep);
    if (!pair) continue;
    const [term, definition] = pair.map((p) => p.trim());
    if (term && definition) out.push({ term, definition });
  }
  return out;
}

/** A spreadsheet's quoted field ("London, England", with "" for a quote inside) as its text. */
function unquote(s) {
  const t = s.trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1).replace(/""/g, '"') : t;
}

/** [term, definition], split at the FIRST separator only: the rest of the line is the definition as written,
 *  so "pi, 3,14" keeps its decimal comma and a second " - " stays a dash. A term in quotes may hold the
 *  separator itself, as a spreadsheet writes it. null when the line has no separator. */
function splitFirst(line, sep) {
  if (line.startsWith('"')) {
    let i = 1, term = "";
    while (i < line.length) {
      if (line[i] === '"') { if (line[i + 1] === '"') { term += '"'; i += 2; continue; } break; }
      term += line[i++];
    }
    const rest = line.slice(i + 1);
    const m = rest.match(sep);
    if (i < line.length && m && m.index === 0) return [term, unquote(rest.slice(m[0].length))];
  }
  const m = line.match(sep);
  if (!m || !m.index) return null;
  return [line.slice(0, m.index), unquote(line.slice(m.index + m[0].length))];
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

// Bussläge: understanding what a student said in answer to a multiple-choice
// question. The browser's recogniser hands back a few guesses at a sentence,
// most likely first; this turns them into one decision — an option, or a
// spoken command (repeat / skip / pause), or nothing we're sure about.
//
// Pure — no DOM, no speech APIs — so it can be tested with plain strings.

import { similarity } from "./speech.js";

// Letters as recognisers actually write them. "de" and "se" are ordinary words
// in Swedish, so a bare one only counts when it's the whole answer.
const LETTERS = {
  a: ["a", "ah", "aa", "ay"],
  b: ["b", "be", "bee", "bi"],
  c: ["c", "se", "see", "sea", "cee", "ce"],
  d: ["d", "de", "dee"],
  e: ["e", "ee", "eh"],
  f: ["f", "eff", "ef"],
};
const NUMBERS = {
  1: ["1", "ett", "en", "etta", "one", "won"],
  2: ["2", "tva", "two", "to", "too"],
  3: ["3", "tre", "three"],
  4: ["4", "fyra", "four", "for"],
  5: ["5", "fem", "five"],
  6: ["6", "sex", "six"],
};

// Words people put in front of the letter: "alternativ B", "svaret är C", "I think it's D".
const FILLER = new Set([
  "alternativ", "alternativet", "svar", "svaret", "bokstav", "bokstaven", "nummer", "numret",
  "jag", "tror", "vill", "valjer", "tar", "ta", "det", "ar", "blir", "kanske", "nog",
  "option", "answer", "letter", "number", "choice", "the", "its", "it", "s", "is", "i", "think", "choose", "pick", "guess",
]);

// Phrases are matched on the plain (lower-case, accent-free) form, longest first.
const COMMANDS = [
  ["repeat", ["upprepa", "en gang till", "sag igen", "sag det igen", "igen", "repeat", "say that again", "say again", "once more", "again"]],
  ["skip", ["hoppa over", "hoppa", "skippa", "nasta fraga", "nasta", "skip", "next question", "next", "pass"]],
  ["stop", ["pausa", "paus", "stopp", "stanna", "sluta", "avsluta", "pause", "stop", "quit", "wait"]],
];

/** Lower case, no accents or punctuation, single spaces. */
export function plain(s) {
  return String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

const letterIndex = (word) => {
  for (const [letter, aliases] of Object.entries(LETTERS)) if (aliases.includes(word)) return letter.charCodeAt(0) - 97;
  for (const [n, aliases] of Object.entries(NUMBERS)) if (aliases.includes(word)) return Number(n) - 1;
  return -1;
};

const hasPhrase = (text, phrase) => ` ${text} `.includes(` ${phrase} `);

/**
 * @param {string[]} heard    the recogniser's guesses, best first
 * @param {string[]} choices  the option texts, in the order they're shown
 * @returns {{type:"choice", index:number}|{type:"repeat"}|{type:"skip"}|{type:"stop"}|null}
 */
export function parseSpokenChoice(heard, choices = []) {
  const n = choices.length;
  const options = choices.map((c) => plain(c));
  for (const raw of heard || []) {
    const text = plain(raw);
    if (!text) continue;

    // Commands first, but only when the answer isn't just an option that happens to share a word.
    for (const [type, phrases] of COMMANDS) {
      if (phrases.some((p) => hasPhrase(text, p)) && !options.includes(text)) return { type };
    }

    // "B", "svar b", "alternativ två", "I think it's C".
    const words = text.split(" ").filter((w) => !FILLER.has(w));
    if (words.length === 1) {
      const i = letterIndex(words[0]);
      if (i >= 0 && i < n) return { type: "choice", index: i };
    }

    // The option itself: "1,25", "koldioxid". Needs a clear winner.
    const said = words.join(" ") || text;
    const scored = options.map((o, i) => ({ i, s: o ? similarity(said, o) : 0 })).sort((a, b) => b.s - a.s);
    if (scored[0] && scored[0].s >= 80 && (scored.length < 2 || scored[0].s - scored[1].s >= 15)) {
      return { type: "choice", index: scored[0].i };
    }
  }
  return null;
}

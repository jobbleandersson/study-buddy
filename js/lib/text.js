// Small text helpers shared across a few otherwise-unrelated call sites. Kept free of regex
// lookbehind assertions on purpose: a lookbehind is a SyntaxError at PARSE time on Safari before
// 16.4 (older iPhones/iPads on iOS 15/16.3), and since these are ES modules one lookbehind anywhere
// in the import graph blanks the whole app on those devices, not just the feature that used it.

/** The first sentence of `text` (through its ending . / ! / ?), or the whole text when there's no
 *  sentence-ending punctuation followed by whitespace or the end of the string. Trailing whitespace
 *  after the punctuation is not included — same result as splitting on a "whitespace that follows
 *  sentence-ending punctuation" lookbehind, just phrased as an earliest-match instead of a split, so
 *  it needs no lookbehind (see the module comment above). */
export function firstSentence(text) {
  const s = String(text ?? "");
  const m = s.match(/^[\s\S]*?[.!?](?=\s|$)/);
  return m ? m[0] : s;
}

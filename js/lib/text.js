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

/** The start of a prompt for a list, at most `max` characters with "…". Never cut inside $…$ maths:
 *  an unclosed $ leaves the rest as raw TeX, so the cut moves back to before the formula it would
 *  split. An escaped dollar (\$) is text, not a delimiter. */
export function previewPrompt(prompt, max = 110) {
  const s = String(prompt ?? "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  let cut = s.slice(0, max - 1);
  const delimiters = cut.replace(/\\$/g, "").split("$").length - 1;
  if (delimiters % 2 === 1) {
    // Back to the last unescaped $: the one that opened the formula left unclosed.
    let i = cut.length - 1;
    while (i >= 0 && !(cut[i] === "$" && cut[i - 1] !== "\\")) i--;
    cut = cut.slice(0, Math.max(0, i));
  }
  return `${cut.trimEnd()}…`;
}

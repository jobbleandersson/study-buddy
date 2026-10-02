// Multiple-choice option order. Pure — no DOM, store or i18n — so it can be tested on its own.
//
// Why this exists: the generator tends to write the correct option first, and the library's own sets
// lean towards the first options too (about half of their answers are A), so a student who has noticed
// can score without reading. Options are shuffled when a set is generated (shuffleMc) and again every
// time a session starts (session.js), which also covers sets saved before this existed.

/** Does any option point at the others? ("Alla ovanstående", "A och B", "None of the above"…) Those
 *  only make sense in the authored order, so such a question is never shuffled. */
export function choicesDependOnOrder(choices) {
  const list = (choices || []).map((c) => String(c ?? ""));
  const refers = [
    /\b(alla|samtliga|ingen|inget|båda|bägge|både)\b[^.]{0,40}\b(ovan|ovanstående|ovannämnda|alternativ|alternativen|svar|svaren)\b/i,
    /\b(all|none|both|neither)\b[^.]{0,30}\b(above|these|those|options|answers|choices)\b/i,
    /\b(alternativ|svarsalternativ|svar|option|answer|choice)\s+[a-e1-5]\b/i,
    /(^|[^\p{L}])[a-e]\s*(och|and|&|\+|,|samt)\s*[a-e]($|[^\p{L}])/iu,
    /\b(ovanstående|above|below)\b/i,
  ];
  return list.some((c) => refers.some((rx) => rx.test(c)));
}

/** A shuffled copy of the index list [0..n-1] (Fisher–Yates). `rng` returns [0, 1). */
export function shuffledIndexes(n, rng = Math.random) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The options of a multiple-choice question in a random order, with `answer` (the index of the correct
 *  one) pointing at the same option as before. Questions whose options depend on their order, and
 *  anything that isn't a valid multiple-choice question, come back unchanged. */
export function shuffleMc({ choices, answer }, rng = Math.random) {
  if (!Array.isArray(choices) || choices.length < 2 || !Number.isInteger(answer) || answer < 0 || answer >= choices.length
    || choicesDependOnOrder(choices)) {
    return { choices, answer };
  }
  const perm = shuffledIndexes(choices.length, rng);    // perm[newIndex] = oldIndex
  return { choices: perm.map((i) => choices[i]), answer: perm.indexOf(answer) };
}

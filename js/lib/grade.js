// A rough Swedish-style letter level (F–A) estimated from a mastery score
// (0–1). Deliberately not a real grade and never presented as one — it's a
// familiar shorthand for "how am I doing in this subject" that maps onto the
// mastery bars the app already shows. Pure and offline: no AI, no network.
//
// Always label it as an estimate wherever it's shown (see prog.gradeExplain /
// results.gradeEyebrow).

const SCALE = [
  [0.40, "F", "low"],
  [0.55, "E", "low"],
  [0.70, "D", "mid"],
  [0.85, "C", "mid"],
  [0.95, "B", "high"],
];

/** mastery 0..1 -> { letter, tier } where tier is "low" | "mid" | "high". */
export function estimatedGrade(mastery) {
  for (const [max, letter, tier] of SCALE) {
    if (mastery < max) return { letter, tier };
  }
  return { letter: "A", tier: "high" };
}

const LETTERS = [...SCALE.map(([, letter]) => letter), "A"];

/** F=0 … A=5, for comparing two estimated grades. */
export function gradeRank(letter) {
  return LETTERS.indexOf(letter);
}

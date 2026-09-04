// Free-text answer matching: normalization + the offline (no-AI) grading
// fallback. Pulled out of components/questions.js so it can be tested/reused
// independently, matching the lib/srs.js / lib/mastery.js pure-logic pattern.

import { t } from "./i18n.js";

/** Normalizes an answer for comparison. Keeps every Unicode letter — å/ä/ö
 *  included — and only touches actual punctuation/formatting noise, unlike
 *  a naive [^a-z0-9] strip which destroys non-ASCII text. */
export function normalizeAnswer(s) {
  let str = String(s ?? "").trim();
  str = str.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/ /g, " ");
  str = str.replace(/\s+/g, " ").trim();
  str = str.replace(/[.!?]+$/g, "").trim();
  // Numeric-shaped tokens only: "2 880" -> "2880" (thousands space),
  // "0,5" -> "0.5" (Swedish decimal comma). Left alone otherwise, so a real
  // comma in prose is never touched.
  str = str.replace(/-?\d[\d ]*(?:,\d+)?/g, (tok) => tok.replace(/(?<=\d) (?=\d)/g, "").replace(",", "."));
  return str.toLowerCase();
}

/** Unicode-aware word split — \p{L} matches å/ä/ö (and every other script),
 *  unlike an ASCII-only [^a-z0-9\s] strip. */
export function tokenize(s) {
  return normalizeAnswer(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3);
}

/** Offline fallback grader, used when there's no live AI proxy. A short
 *  model answer ("19", "12 Ω") can't be fairly judged by keyword overlap —
 *  it's graded by exact match after normalizing instead. Longer answers
 *  fall back to keyword overlap. */
export function heuristic(ans, model) {
  const modelStr = String(model ?? "").trim();
  if (!modelStr) return { correct: false, feedback: t("q.heuristicMiss"), missedPoints: [] };

  const modelWords = modelStr.split(/\s+/).filter(Boolean).length;
  if (modelWords <= 3) {
    const correct = normalizeAnswer(ans) === normalizeAnswer(modelStr);
    return { correct, feedback: correct ? t("q.heuristicOk") : t("q.heuristicMiss"), missedPoints: [] };
  }

  const mTokens = tokenize(modelStr);
  const aTokens = new Set(tokenize(ans));
  if (!mTokens.length) {
    return { correct: tokenize(ans).length > 0, feedback: t("q.heuristicMiss"), missedPoints: [] };
  }
  const hit = mTokens.filter((w) => aTokens.has(w)).length / mTokens.length;
  return {
    correct: hit >= 0.34,
    feedback: hit >= 0.34 ? t("q.heuristicOk") : t("q.heuristicMiss"),
    missedPoints: [],
  };
}

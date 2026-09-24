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

/** Drops accents a Swedish keyboard can't type (é à ê ç ñ ...) so "sábado", "pequeña" and "quién"
 *  can be matched by someone who typed "sabado", "pequena" and "quien". å ä ö ü are deliberately kept:
 *  in Swedish and German they make different words ("får"/"far", "schön"/"schon", "Mütter"/"Mutter"),
 *  so folding them would mark a wrong answer right. */
const KEEP = new Set(["å", "ä", "ö", "ü"]);
export function foldAccents(s) {
  return Array.from(String(s ?? "").normalize("NFC"), (c) =>
    KEEP.has(c.toLowerCase()) ? c : c.normalize("NFD").replace(/[\u0300-\u036f]/g, "")).join("");
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
    const a = normalizeAnswer(ans);
    const m = normalizeAnswer(modelStr);
    if (a === m) return { correct: true, feedback: t("q.heuristicOk"), missedPoints: [] };
    // Right word, missing accent: accept it (many students can't type the accent) but say so, since
    // the accent is part of the spelling they are learning.
    if (foldAccents(a) === foldAccents(m)) {
      return { correct: true, feedback: t("q.heuristicOkAccent", { answer: modelStr }), missedPoints: [] };
    }
    return { correct: false, feedback: t("q.heuristicMiss"), missedPoints: [] };
  }

  const mTokens = tokenize(modelStr).map(foldAccents);
  const aTokens = new Set(tokenize(ans).map(foldAccents));
  if (!mTokens.length) {
    return { correct: tokenize(ans).length > 0, feedback: t("q.heuristicMiss"), missedPoints: [] };
  }
  // Keyword overlap alone is a weak signal — a vaguely on-topic sentence can
  // clear a low bar. Ask for at least half the model's key words, and never
  // pass an answer much shorter than the model. The model answer is shown
  // either way, so a near-miss the student actually got is theirs to appeal.
  const hit = mTokens.filter((w) => aTokens.has(w)).length / mTokens.length;
  const longEnough = aTokens.size >= Math.max(2, Math.ceil(mTokens.length * 0.4));
  const correct = hit >= 0.5 && longEnough;
  return {
    correct,
    feedback: correct ? t("q.heuristicOk") : t("q.heuristicMiss"),
    missedPoints: [],
  };
}

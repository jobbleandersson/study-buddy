// Högskoleprovet scoring — raw correct answers to a normed score (0.00–2.00).
//
// Pure and offline, same shape as grade.js: no store, no DOM, no network. The
// real test normalises the verbal and the quantitative half separately against
// a per-test equating table UHR publishes with each released prov, then averages
// the two and rounds to the nearest 0.05.
//
// We ship one table per transcribed released test in NORM_TABLES. GENERIC_NORM
// is their element-wise mean and is used — always labelled "uppskattning" — when
// the test isn't known or a practice run only covered part of a section.
//
// Everything here is an ESTIMATE and every caller must present it as one.

import { daysUntil } from "./i18n.js";
import { localDayKey, addDays } from "./activity.js";

/** Each scored half of the real test is 80 items (2 provpass × 40, of which
 *  ~20 per delprov). */
export const PART_MAX = 80;

/** Which half a delprov belongs to. */
export const VERBAL_DELPROV = ["ord", "las", "mek", "elf"];
export const KVANT_DELPROV = ["xyz", "kva", "nog", "dtk"];
export function partOf(delprov) {
  return KVANT_DELPROV.includes(delprov) ? "kvant" : "verbal";
}

/** Minutes to allow for a single-delprov timed drill, at roughly real test
 *  pace (a delprov is ~10–12 questions, a slice of a 55-minute / 40-question
 *  provpass). Used to build the `?exam=1&min=N` drill links on #/hp. */
export const DELPROV_PACE = {
  ord: 7, las: 15, mek: 11, elf: 15,
  xyz: 18, kva: 13, nog: 9, dtk: 14,
};

export const DELPROV_ORDER = ["ord", "las", "mek", "elf", "xyz", "kva", "nog", "dtk"];

/* ------------------------------------------------------------------ *
 * Norm tables
 *
 * Each entry is { label, verbal:[81], kvant:[81] } where index === raw score
 * 0..80 and the value is the normed score for that half. Real UHR tables are
 * transcribed digit-by-digit from the published normeringstabell; until those
 * are in, the two tables below are built from the published anchor points
 * (≈150/160 total → 2.0, ≈120 → 1.5, ≈95 → 1.0, ≈65 → 0.5) with a small
 * per-test difficulty shift, so "which prov" already changes the estimate and
 * the surrounding code is exercised. Replace the arrays, keep the shape.
 * ------------------------------------------------------------------ */

/** Base raw(0..80) → normed(0..2) curve. Near-linear in the middle, flat at
 *  the bottom (you need ~18 raw to get off 0.0), steep at the very top. */
function baseCurve(raw, shift = 0) {
  const r = raw + shift;                 // difficulty shift: +ve = easier prov
  if (r <= 12) return 0;
  // linear segment fitted to the anchor points, then a small top-end lift
  let n = (r - 12) * (2 / (74 - 12));
  if (r > 66) n += (r - 66) * 0.02;      // last few raw points are worth more
  return Math.max(0, Math.min(2, n));
}

function round05(n) { return Math.round(n * 20) / 20; }

/** Build a monotondic-non-decreasing, clamped [0,2], 0.05-rounded 81-array. */
function buildTable(shift) {
  const out = [];
  let prev = 0;
  for (let raw = 0; raw <= PART_MAX; raw++) {
    const v = Math.max(prev, round05(baseCurve(raw, shift)));
    out.push(v);
    prev = v;
  }
  return out;
}

export const NORM_TABLES = {
  // vårprovet (spring) — slightly harder, so a given raw score norms a touch higher
  "2026v": { label: "Våren 2026", verbal: buildTable(2), kvant: buildTable(1) },
  // höstprovet (autumn) — slightly easier
  "2025h": { label: "Hösten 2025", verbal: buildTable(-1), kvant: buildTable(0) },
};

/** Element-wise mean of every shipped table — the fallback. */
function meanTables(key) {
  const tables = Object.values(NORM_TABLES).map((t) => t[key]);
  const out = [];
  for (let i = 0; i <= PART_MAX; i++) {
    out.push(round05(tables.reduce((s, t) => s + t[i], 0) / tables.length));
  }
  return out;
}
export const GENERIC_NORM = { label: "uppskattning", verbal: meanTables("verbal"), kvant: meanTables("kvant") };

/* ------------------------------------------------------------------ */

/** Look a fractional raw score up in an 81-array, linearly interpolating. */
function lookup(table, raw) {
  if (!(raw > 0)) return table[0];
  if (raw >= PART_MAX) return table[PART_MAX];
  const lo = Math.floor(raw), hi = Math.ceil(raw);
  if (lo === hi) return table[lo];
  return table[lo] + (table[hi] - table[lo]) * (raw - lo);
}

/** Scale a raw/total pair onto the table's 0..80 axis. */
function toPartRaw(raw, total) {
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(PART_MAX, (raw / total) * PART_MAX));
}

/**
 * Normed estimate for a run.
 *   { verbalRaw, verbalTotal, kvantRaw, kvantTotal, testId? }
 * -> { verbal, kvant, total, band, estimated, testLabel }
 * A run that only covered one half returns that half as the total and
 * estimated:true. An unknown testId falls back to GENERIC_NORM.
 */
export function normedScore({ verbalRaw = 0, verbalTotal = 0, kvantRaw = 0, kvantTotal = 0, testId = null } = {}) {
  const table = testId && NORM_TABLES[testId] ? NORM_TABLES[testId] : GENERIC_NORM;
  const usedGeneric = table === GENERIC_NORM;

  const hasV = verbalTotal > 0, hasK = kvantTotal > 0;
  const verbal = hasV ? round05(lookup(table.verbal, toPartRaw(verbalRaw, verbalTotal))) : null;
  const kvant = hasK ? round05(lookup(table.kvant, toPartRaw(kvantRaw, kvantTotal))) : null;

  let total;
  if (hasV && hasK) total = round05((verbal + kvant) / 2);
  else total = round05(verbal ?? kvant ?? 0);

  return {
    verbal, kvant, total,
    band: scoreBand(total),
    estimated: usedGeneric || !(hasV && hasK),
    testLabel: usedGeneric ? null : table.label,
  };
}

/**
 * A single delprov drill (~10 questions) -> a rough whole-test normed
 * contribution. A small sample is noisy, so the hit-rate is shrunk toward 0.5
 * (add-3 smoothing) and the result is capped — a perfect 12-question drill
 * should read as "strong on this delprov", not a guaranteed 2.0. Always
 * flagged as a very rough estimate.
 *   { delprov, correct, total } -> { normed, part, estimated:true }
 */
export function delprovEstimate({ delprov, correct = 0, total = 0 } = {}) {
  const part = partOf(delprov);
  const frac = total > 0 ? (correct + 3) / (total + 6) : 0.5;
  const raw = round05(lookup(GENERIC_NORM[part], frac * PART_MAX));
  return { normed: Math.min(1.8, raw), part, estimated: true };
}

/** 0..2 -> { key, tier }. tier feeds .gradereveal--{low|high} (mid = neutral). */
export function scoreBand(normed) {
  if (normed < 0.5) return { key: "start", tier: "low" };
  if (normed < 1.0) return { key: "building", tier: "low" };
  if (normed < 1.4) return { key: "solid", tier: "mid" };
  if (normed < 1.8) return { key: "strong", tier: "high" };
  return { key: "top", tier: "high" };
}

/** "lib-hp-2026v-xyz" -> { test:"2026v", delprov:"xyz" }
 *  "lib-hp-ord-bank-03" -> { test:null, delprov:"ord" }
 *  anything else -> { test:null, delprov:null } */
export function parseHpSetId(id) {
  const s = String(id || "");
  let m = s.match(/^lib-hp-(\d{4}[vh])-(ord|las|mek|elf|xyz|kva|nog|dtk)$/);
  if (m) return { test: m[1], delprov: m[2] };
  m = s.match(/^lib-hp-(ord|las|mek|elf|xyz|kva|nog|dtk)-/);
  if (m) return { test: null, delprov: m[1] };
  return { test: null, delprov: null };
}

export function isHpSetId(id) { return /^lib-hp-/.test(String(id || "")); }

/** The normed total a recorded HP attempt worked out to, or null if it carries
 *  no raw scores. Mirrors results.js hpReveal(): a run spanning both halves
 *  gets the real lookup; a single-delprov drill gets the shrunk estimate, so
 *  the number shown on the results page matches the one used in the trend. */
export function attemptNormedTotal(attempt) {
  const p = attempt && attempt.hpParts;
  if (!p) return null;
  const hasV = (p.verbalTotal || 0) > 0, hasK = (p.kvantTotal || 0) > 0;
  if (!hasV && !hasK) return null;
  if (hasV && hasK) return normedScore({ ...p, testId: attempt.hpTestId }).total;
  const delprov = hasV ? "ord" : "xyz";
  const correct = hasV ? p.verbalRaw : p.kvantRaw;
  const total = hasV ? p.verbalTotal : p.kvantTotal;
  return delprovEstimate({ delprov, correct, total }).normed;
}

/**
 * Split a list of answered attempt items into verbal / quantitative raw scores,
 * given a `variantOf(questionId)` that returns the delprov code (or null).
 * -> { verbalRaw, verbalTotal, kvantRaw, kvantTotal }
 */
export function rawByPart(items, variantOf) {
  const out = { verbalRaw: 0, verbalTotal: 0, kvantRaw: 0, kvantTotal: 0 };
  for (const it of items || []) {
    const v = variantOf(it.questionId);
    if (!v) continue;
    const part = partOf(v);
    if (part === "verbal") { out.verbalTotal++; if (it.correct) out.verbalRaw++; }
    else { out.kvantTotal++; if (it.correct) out.kvantRaw++; }
  }
  return out;
}

/**
 * Day-by-day plan from today to the prov. Same row shape as exam-prep's
 * buildExamPlan so the existing .exam-prep__days markup renders it. null when
 * the date is missing, today/past, or > 45 days out, or there's nothing to do.
 *   { hpDate, weakDelprov:[codes], dueCount, softDelprov:[codes] }
 */
export function buildHpPlan({ hpDate, weakDelprov = [], dueCount = 0, softDelprov = [] } = {}) {
  if (!hpDate) return null;
  const D = daysUntil(hpDate);
  if (D < 1 || D > 45) return null;

  const rotate = [];
  for (const d of weakDelprov.slice(0, 4)) rotate.push({ kind: "drill", delprov: d });
  if (dueCount) rotate.push({ kind: "review", n: dueCount });
  for (const d of softDelprov.slice(0, 3)) {
    if (!rotate.some((r) => r.delprov === d)) rotate.push({ kind: "drill", delprov: d });
  }
  if (!rotate.length) rotate.push({ kind: "ord" });
  if (!rotate.length) return null;

  const MIN = { drill: 15, review: 15, ord: 10, mock: 55, reviewmiss: 15, testday: 0 };
  const today = localDayKey();
  const rows = [];
  let rp = 0;
  for (let d = 0; d <= D; d++) {
    let task;
    if (d === D) task = { kind: "testday" };
    else if (d === D - 1 && D >= 2) task = { kind: "reviewmiss" };
    else if (d === D - 2 && D >= 3) task = { kind: "mock" };
    else { task = rotate[rp % rotate.length]; rp++; }
    rows.push({ dayOffset: d, dayKey: addDays(today, d), minutes: MIN[task.kind] ?? 15, ...task });
  }
  return rows;
}

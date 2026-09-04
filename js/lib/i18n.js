// Language: English / Swedish.
//
// Mirrors lib/theme.js — read straight from localStorage so the page never
// flashes the wrong language, and a change fires an event the router listens
// for. The strings themselves live in lib/strings.js.

import { STRINGS } from "./strings.js";

const KEY = "studybuddy.lang";

// Flag emoji render as bare "GB"/"SE" text on platforms without a color-emoji
// font (stock Windows Chrome included), so these are small inline SVGs
// instead — draws the same everywhere, no font dependency.
const FLAG_GB = '<svg viewBox="0 0 20 14" xmlns="http://www.w3.org/2000/svg">' +
  '<rect width="20" height="14" fill="#00247d"/>' +
  '<path d="M0 0L20 14M20 0L0 14" stroke="#fff" stroke-width="2.4" fill="none"/>' +
  '<path d="M0 0L20 14M20 0L0 14" stroke="#cf142b" stroke-width="1.6" fill="none"/>' +
  '<path d="M10 0V14M0 7H20" stroke="#fff" stroke-width="4" fill="none"/>' +
  '<path d="M10 0V14M0 7H20" stroke="#cf142b" stroke-width="2.4" fill="none"/>' +
  '</svg>';
const FLAG_SE = '<svg viewBox="0 0 20 14" xmlns="http://www.w3.org/2000/svg">' +
  '<rect width="20" height="14" fill="#006aa7"/>' +
  '<rect x="7" width="3.5" height="14" fill="#fecc02"/>' +
  '<rect y="5.5" width="20" height="3" fill="#fecc02"/>' +
  '</svg>';

// Swedish first — every bundled set is Swedish curriculum content, and the
// app itself defaults to sv (see detectLang() below), so this is the order
// that matches, everywhere LANGS drives a listing (Settings' dropdown,
// the sidebar's two-flag picker).
export const LANGS = [
  ["sv", "Svenska", FLAG_SE],
  ["en", "English", FLAG_GB],
];
const SUPPORTED = LANGS.map(([code]) => code);
const FALLBACK = "en";

/** Default when the user hasn't chosen. Every bundled set is Swedish
 *  curriculum content, so that's the default regardless of what the browser
 *  reports — not a browser-language guess. */
function detectLang() {
  return "sv";
}

export function getLang() {
  const stored = localStorage.getItem(KEY);
  return SUPPORTED.includes(stored) ? stored : detectLang();
}

/** True when the language came from the browser rather than an explicit choice. */
export function isAutoLang() {
  return !SUPPORTED.includes(localStorage.getItem(KEY));
}

export function applyLang(lang = getLang()) {
  document.documentElement.setAttribute("lang", lang);
}

export function setLang(lang) {
  if (!SUPPORTED.includes(lang)) return;
  localStorage.setItem(KEY, lang);
  applyLang(lang);
  window.dispatchEvent(new CustomEvent("sb:langchange", { detail: { lang } }));
}

/**
 * t("menu.newSet") -> "New set"
 * t("session.questionOf", { n: 2, total: 5 }) -> "Question 2 of 5"
 * Falls back sv -> en -> the key itself, so a missing translation degrades to
 * English rather than to a blank or a crash.
 */
export function t(key, vars) {
  const lang = getLang();
  let s = STRINGS[lang]?.[key];
  if (s == null) s = STRINGS[FALLBACK]?.[key];
  if (s == null) {
    console.warn("[i18n] missing string:", key);
    return key;
  }
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}

/** Picks a singular/plural key and passes {n} through. Both languages are
 *  one-vs-other, so a single rule covers them. */
export function plural(n, oneKey, otherKey, vars = {}) {
  return t(n === 1 ? oneKey : otherKey, { n, ...vars });
}

/* ---------------- dates ---------------- */

function locale() { return getLang() === "sv" ? "sv-SE" : "en-GB"; }

function parseDayKey(dayKey) {
  const [y, m, d] = String(dayKey).split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** "fre 5 sep" / "Fri 5 Sep" — a due date, written the way the locale writes it. */
export function fmtDate(dayKey) {
  if (!dayKey) return "";
  try {
    return new Intl.DateTimeFormat(locale(), {
      weekday: "short", day: "numeric", month: "short",
    }).format(parseDayKey(dayKey));
  } catch {
    return dayKey;
  }
}

/** Whole days from today to dayKey. Negative = in the past. */
export function daysUntil(dayKey, today = new Date()) {
  const a = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((parseDayKey(dayKey) - a) / 86400000);
}

/**
 * "Today" / "Tomorrow" / "in 3 days" / "Overdue by 2 days".
 * Shared by the due-date list and the spaced-repetition list so the two read
 * the same way.
 */
export function relativeDay(dayKey, today = new Date()) {
  const d = daysUntil(dayKey, today);
  if (d === 0) return t("date.today");
  if (d === 1) return t("date.tomorrow");
  // No "Yesterday" branch: a deadline one day past is overdue, and "Yesterday"
  // made a missed deadline read like a neutral date stamp rather than a miss.
  if (d > 1) {
    if (d < 7) return t("date.inDays", { n: d });
    if (d < 30) return plural(Math.round(d / 7), "date.inWeekOne", "date.inWeeks");
    return plural(Math.round(d / 30), "date.inMonthOne", "date.inMonths");
  }
  return plural(-d, "date.overdueOne", "date.overdueMany");
}

/* ---------------- AI language ---------------- */

/**
 * Appended to every Claude system prompt. Empty for English so those prompts
 * are byte-identical to before, which keeps them cache-friendly.
 */
export function aiLangInstruction() {
  if (getLang() !== "sv") return "";
  return `

IMPORTANT — LANGUAGE: Write everything you produce in Swedish (svenska). That includes question text, answer choices, model answers, explanations, hints, feedback and your chat replies. Use natural, age-appropriate Swedish for a school pupil. Keep JSON keys and any field names in English exactly as specified — only the human-readable values are in Swedish.`;
}

// "Lyssna som samtal": a short two-person conversation about a set, written once by the AI and then
// read aloud by the device's own speech voices. This file is the pure part - reading the AI's script
// safely and remembering finished scripts so listening again costs nothing.

const KEY = "studify.talks.v1";
export const MIN_LINES = 4;
export const MAX_LINES = 24;
export const MAX_LINE_CHARS = 400;
export const MAX_CACHED = 8;

const defaultStorage = () => (typeof localStorage === "undefined" ? null : localStorage);

/** Speech and markdown do not mix: strip what would be read out as symbols. */
function speakable(s) {
  return String(s ?? "").replace(/[*_`#>~]/g, "").replace(/\$/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_LINE_CHARS);
}

/** The model's reply -> { title, lines: [{ who: "A" | "S", text }] }. Accepts { title, lines } or a bare
 *  array; throws when there is not enough conversation to play. */
export function parseScript(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.lines) ? raw.lines : null;
  if (!list) throw new Error("no lines");
  let last = "S";
  const lines = [];
  for (const item of list) {
    const text = speakable(typeof item === "string" ? item : item?.text);
    if (!text) continue;
    const who = String(item?.who ?? "").trim().toLowerCase();
    // Sam / S / host 2 / B -> Sam; anything else that names a speaker -> Alex; no speaker -> the other one.
    const speaker = /^(s|sam|b|2|host ?2)/.test(who) ? "S" : who ? "A" : last === "A" ? "S" : "A";
    lines.push({ who: speaker, text });
    last = speaker;
    if (lines.length >= MAX_LINES) break;
  }
  if (lines.length < MIN_LINES) throw new Error("too short");
  return { title: speakable(raw?.title).slice(0, 80), lines };
}

/** About how long the conversation runs at normal speed (speech is roughly 150 words a minute). */
export function estimateMinutes(lines) {
  const words = (lines || []).reduce((n, l) => n + String(l.text).split(/\s+/).filter(Boolean).length, 0);
  return Math.max(1, Math.round(words / 150));
}

function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** A cache key that changes when the set's content does, so an edited set gets a fresh conversation. */
export function scriptKey(assignment, lang = "sv") {
  const qs = Array.isArray(assignment?.questions) ? assignment.questions : [];
  return `${assignment?.id}:${lang}:${hash([assignment?.title, ...qs.map((q) => q.prompt)].join("|"))}`;
}

function readAll(storage) {
  try {
    const v = JSON.parse(storage?.getItem(KEY) || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

export function loadScript(key, storage = defaultStorage()) {
  const hit = readAll(storage)[key];
  try { return hit ? parseScript(hit.script) : null; } catch { return null; }
}

export function saveScript(key, script, storage = defaultStorage(), now = Date.now()) {
  const all = { ...readAll(storage), [key]: { script, at: now } };
  const keep = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_CACHED);
  try { storage.setItem(KEY, JSON.stringify(Object.fromEntries(keep))); return true; } catch { return false; }
}

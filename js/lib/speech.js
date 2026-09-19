// Read-aloud via the browser's built-in SpeechSynthesis — free, offline, no
// server. Voice availability (and Swedish quality) varies by device, so the
// student can pick a voice; the choice and the "auto-read questions" toggle
// are remembered in localStorage.

import { getLang } from "./i18n.js";
import { segmentPrompt, choicesAreTarget } from "./lang-detect.js";

const VOICE_KEY = "studybuddy.ttsVoice";
const AUTO_KEY = "studybuddy.ttsAuto";
const RATE_KEY = "studybuddy.ttsRate";

export function speechSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window
    && typeof window.SpeechSynthesisUtterance === "function";
}

let _voices = [];
function refreshVoices() {
  if (!speechSupported()) return [];
  try { _voices = window.speechSynthesis.getVoices() || []; } catch { _voices = []; }
  return _voices;
}
if (speechSupported()) {
  refreshVoices();
  // Chrome loads voices asynchronously — repopulate when they arrive.
  try { window.speechSynthesis.addEventListener("voiceschanged", refreshVoices); } catch {}
}

const bcp = () => (getLang() === "sv" ? "sv-SE" : "en-GB");

/** Voices whose language matches the current UI language. */
export function voicesForLang(lang = getLang()) {
  const prefix = lang === "sv" ? "sv" : "en";
  return refreshVoices().filter((v) => (v.lang || "").toLowerCase().startsWith(prefix));
}

export function getPreferredVoiceURI() {
  try { return localStorage.getItem(VOICE_KEY) || ""; } catch { return ""; }
}
export function setPreferredVoiceURI(uri) {
  try { uri ? localStorage.setItem(VOICE_KEY, uri) : localStorage.removeItem(VOICE_KEY); } catch {}
}
export function getAutoRead() {
  try { return localStorage.getItem(AUTO_KEY) === "1"; } catch { return false; }
}
export function setAutoRead(on) {
  try { on ? localStorage.setItem(AUTO_KEY, "1") : localStorage.removeItem(AUTO_KEY); } catch {}
}
export function getRate() {
  try { return Number(localStorage.getItem(RATE_KEY)) || 1; } catch { return 1; }
}
export function setRate(r) {
  try { localStorage.setItem(RATE_KEY, String(r)); } catch {}
}

function pickVoice() {
  const all = refreshVoices();
  const want = getPreferredVoiceURI();
  if (want) {
    const v = all.find((x) => x.voiceURI === want);
    if (v) return v;
  }
  const langVoices = voicesForLang();
  // Prefer a local (on-device) voice — it works offline and starts instantly.
  return langVoices.find((v) => v.localService) || langVoices[0] || null;
}

/** Flatten markdown / LaTeX / cloze markup to something that reads as speech. */
export function toSpeakable(text) {
  return String(text || "")
    .replace(/\{\{([^}|]*)(?:\|[^}]*)?\}\}/g, " $1 ")   // cloze -> first alternative
    .replace(/\$\$?([^$]*)\$\$?/g, " $1 ")               // math -> inner text
    .replace(/`([^`]*)`/g, "$1")
    .replace(/[#*_>~\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The best installed voice for a BCP-47 language ("es-ES"): the exact locale
 *  first, then any voice for that language, preferring on-device ones.
 *  null when the device has none. */
export function voiceForBcp(tag) {
  const want = String(tag || "").toLowerCase();
  const lang = want.slice(0, 2);
  const all = refreshVoices().filter((v) => (v.lang || "").toLowerCase().replace("_", "-").startsWith(lang));
  const exact = all.filter((v) => (v.lang || "").toLowerCase().replace("_", "-") === want);
  return exact.find((v) => v.localService) || exact[0] || all.find((v) => v.localService) || all[0] || null;
}

/**
 * Speak a list of { text, bcp? } runs back to back, each in its own voice —
 * `bcp` picks a voice for that language, none means the student's own
 * (Swedish/English, honouring their chosen voice). Cancels anything already
 * speaking. `rate` scales the student's speed (0.7 = slower). Returns false if
 * TTS isn't available or there's nothing to say.
 */
export function speakSegments(segments, { rate = 1, onstart, onend, onerror } = {}) {
  if (!speechSupported()) return false;
  const parts = (segments || [])
    .map((s) => ({ text: toSpeakable(s.text), bcp: s.bcp || null }))
    .filter((p) => p.text);
  if (!parts.length) return false;
  try {
    window.speechSynthesis.cancel();
    const speed = Math.min(1.5, Math.max(0.5, getRate() * rate));
    parts.forEach((p, i) => {
      const u = new SpeechSynthesisUtterance(p.text);
      const v = p.bcp ? voiceForBcp(p.bcp) : pickVoice();
      if (v) u.voice = v;
      u.lang = v?.lang || p.bcp || bcp();
      u.rate = speed;
      if (i === 0 && onstart) u.onstart = onstart;
      if (i === parts.length - 1 && onend) u.onend = onend;
      u.onerror = (e) => { if (onerror) onerror(e); };
      window.speechSynthesis.speak(u);
    });
    return true;
  } catch {
    return false;
  }
}

/** Speak `text` in the student's own voice. Cancels anything already
 *  speaking. Returns false if TTS isn't available or there's nothing to say. */
export function speak(text, opts) {
  return speakSegments([{ text }], opts);
}

export function stopSpeaking() {
  try { window.speechSynthesis.cancel(); } catch {}
}
export function isSpeaking() {
  try { return window.speechSynthesis.speaking || window.speechSynthesis.pending; } catch { return false; }
}

/* ---- speaking practice: the browser's own speech recognition ---- */

export function recognitionSupported() {
  return typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/** Listen once in `tag` (a BCP-47 language). onresult gets the recognizer's
 *  best guesses, most likely first. Returns { stop() }, or null if it can't
 *  start (no support, or the browser refused). */
export function listenOnce(tag, { onresult, onerror, onend } = {}) {
  const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
  if (!SR) return null;
  try { window.speechSynthesis?.cancel(); } catch {}
  const rec = new SR();
  rec.lang = tag;
  rec.interimResults = false;
  rec.continuous = false;
  rec.maxAlternatives = 3;
  rec.onresult = (e) => onresult?.([...(e.results[0] || [])].map((a) => a.transcript));
  rec.onerror = (e) => onerror?.(e.error || "error");
  rec.onend = () => onend?.();
  try { rec.start(); } catch { return null; }
  return { stop: () => { try { rec.stop(); } catch {} } };
}

const plain = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

/** 0–100: how closely what was heard matches what was meant — ignoring
 *  case, accents and punctuation, which a recognizer doesn't reliably supply. */
export function similarity(heard, meant) {
  const a = plain(heard), b = plain(meant);
  if (!a || !b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return Math.round(100 * (1 - prev[b.length] / Math.max(a.length, b.length)));
}

/**
 * A question as spoken runs for a language set: the quoted Spanish / German /
 * French / English in the target voice, the instructions around it in the
 * student's, and the options in whichever language they're written in. Gaps
 * become a pause. `target` is { code, bcp } from lang-detect's targetLangFor.
 */
export function questionToSegments(q, t, target) {
  if (!q) return [];
  if (!target) return [{ text: questionToSpeech(q, t) }];
  const gapped = (s) => s.replace(/_{2,}/g, ", ");
  const prompt = q.kind === "cloze" ? String(q.prompt || "").replace(/\{\{[^}]*\}\}/g, " ___ ") : q.prompt;
  const segs = segmentPrompt(prompt, target.code)
    .map((s) => ({ text: gapped(s.text), bcp: s.target ? target.bcp : null }));
  if (q.kind === "mc" && Array.isArray(q.choices)) {
    const inTarget = choicesAreTarget(q.choices, q.prompt, target.code);
    // The letter shares its option's voice, so "A" isn't spelled in Swedish
    // in front of an English or Spanish answer.
    const bcpFor = inTarget ? target.bcp : null;
    q.choices.forEach((c, i) => {
      segs.push({ text: `${String.fromCharCode(65 + i)}.`, bcp: bcpFor });
      segs.push({ text: c, bcp: bcpFor });
    });
  }
  return segs;
}

/** Turn a question into one spoken passage: the prompt, then the options for
 *  multiple choice, or the sentence with "blank" spoken for each gap. */
export function questionToSpeech(q, t) {
  if (!q) return "";
  const tr = (k, v) => (t ? t(k, v) : k);

  // Högskoleprov framing material — read before the prompt.
  let prefix = "";
  const s = q.stimulus;
  if (s && s.body) {
    prefix += (s.title ? s.title + ". " : "") + toSpeakable(s.body) + ". ";
  } else if (s && Array.isArray(s.quantities)) {
    prefix += `${tr("hp.kvaColI")}: ${toSpeakable(s.quantities[0] || "")}. `
      + `${tr("hp.kvaColII")}: ${toSpeakable(s.quantities[1] || "")}. `
      + (s.given ? `${tr("hp.kvaGivenLabel")} ${toSpeakable(s.given)}. ` : "");
  } else if (s && Array.isArray(s.statements)) {
    prefix += s.statements
      .map((l, i) => `(${i + 1}) ${toSpeakable(String(l).replace(/^\(\d+\)\s*/, ""))}`)
      .join(". ") + ". ";
  }
  if (q.figure && q.figure.alt) prefix += `${tr("hp.speakFigure")}: ${toSpeakable(q.figure.alt)}. `;

  if (q.kind === "cloze") {
    return prefix + toSpeakable(String(q.prompt || "").replace(/\{\{[^}]*\}\}/g, ` ${tr("q.readBlankWord")} `));
  }
  let out = prefix + toSpeakable(q.prompt);
  if (q.kind === "mc" && Array.isArray(q.choices)) {
    const letters = ["A", "B", "C", "D", "E", "F"];
    out += ". " + q.choices.map((c, i) => `${letters[i] || i + 1}. ${toSpeakable(c)}`).join(". ");
  }
  return out;
}

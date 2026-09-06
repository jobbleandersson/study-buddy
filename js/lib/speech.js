// Read-aloud via the browser's built-in SpeechSynthesis — free, offline, no
// server. Voice availability (and Swedish quality) varies by device, so the
// student can pick a voice; the choice and the "auto-read questions" toggle
// are remembered in localStorage.

import { getLang } from "./i18n.js";

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
  try { window.speechSynthesis.addEventListener("voiceschange", refreshVoices); } catch {}
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

/** Speak `text`. Cancels anything already speaking. Returns false if TTS
 *  isn't available or there's nothing to say. */
export function speak(text, { onstart, onend, onerror } = {}) {
  if (!speechSupported()) return false;
  const s = toSpeakable(text);
  if (!s) return false;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(s);
    const v = pickVoice();
    if (v) u.voice = v;
    u.lang = v?.lang || bcp();
    u.rate = Math.min(1.5, Math.max(0.6, getRate()));
    if (onstart) u.onstart = onstart;
    if (onend) u.onend = onend;
    u.onerror = (e) => { if (onerror) onerror(e); };
    window.speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}

export function stopSpeaking() {
  try { window.speechSynthesis.cancel(); } catch {}
}
export function isSpeaking() {
  try { return window.speechSynthesis.speaking || window.speechSynthesis.pending; } catch { return false; }
}

/** Turn a question into one spoken passage: the prompt, then the options for
 *  multiple choice, or the sentence with "blank" spoken for each gap. */
export function questionToSpeech(q, t) {
  if (!q) return "";
  if (q.kind === "cloze") {
    return toSpeakable(String(q.prompt || "").replace(/\{\{[^}]*\}\}/g, ` ${t ? t("q.readBlankWord") : "blank"} `));
  }
  let out = toSpeakable(q.prompt);
  if (q.kind === "mc" && Array.isArray(q.choices)) {
    const letters = ["A", "B", "C", "D", "E", "F"];
    out += ". " + q.choices.map((c, i) => `${letters[i] || i + 1}. ${toSpeakable(c)}`).join(". ");
  }
  return out;
}

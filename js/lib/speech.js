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

/* ---- voice quality: rank what the device has ---- */

// Names that mark a better-sounding voice ("Microsoft Sofie Online (Natural)", an Apple "Enhanced" or
// "Premium" download, Google's neural/WaveNet ones) and the old robotic engines to avoid.
const NATURAL_RE = /natural|neural|premium|enhanced|wavenet|studio|\bhd\b/i;
const ROBOTIC_RE = /espeak|festival|flite|compact/i;

const normTag = (v) => String(v?.lang || "").toLowerCase().replace("_", "-");
export const voiceIsNatural = (v) => NATURAL_RE.test(v?.name || "");
/** Not `localService`: the browser sends the text to its vendor (Microsoft/Google) to be voiced. */
export const voiceIsOnline = (v) => !v?.localService;

/** Higher is better. On-device beats online by a wide margin - it's instant, works offline and the text
 *  never leaves the device - so the automatic choice stays private; a student who wants an online
 *  "Natural" voice picks it themselves, and the list labels it. Within each, natural beats basic, and
 *  the voice for this exact locale beats another region's. */
export function voiceScore(v, lang = getLang()) {
  let s = 0;
  if (v?.localService) s += 300;
  if (voiceIsNatural(v)) s += 100;
  if (ROBOTIC_RE.test(v?.name || "")) s -= 100;
  const tag = normTag(v);
  if (tag === (lang === "sv" ? "sv-se" : "en-gb")) s += 10;
  else if (lang !== "sv" && tag === "en-us") s += 5;
  return s;
}

/** A copy of `list`, best voice first (name breaks ties so the order is stable). */
export function rankVoices(list, lang = getLang()) {
  return [...list].sort((a, b) => voiceScore(b, lang) - voiceScore(a, lang)
    || String(a?.name).localeCompare(String(b?.name)));
}

/** The voice to use: the student's own pick while it is still installed, else the best one for `lang`. */
export function chooseVoice(all, { preferredURI = "", lang = getLang() } = {}) {
  if (preferredURI) {
    const v = all.find((x) => x.voiceURI === preferredURI);
    if (v) return v;
  }
  const prefix = lang === "sv" ? "sv" : "en";
  return rankVoices(all.filter((v) => normTag(v).startsWith(prefix)), lang)[0] || null;
}

function pickVoice() {
  return chooseVoice(refreshVoices(), { preferredURI: getPreferredVoiceURI() });
}

/** Which OS a student is on, for "how to get a better voice" advice. */
export function platformKind(ua = typeof navigator !== "undefined" ? navigator.userAgent : "",
  touchPoints = typeof navigator !== "undefined" ? navigator.maxTouchPoints : 0) {
  if (/android/i.test(ua)) return "android";
  // iPadOS reports a Mac user agent; the touch screen gives it away.
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && touchPoints > 1)) return "ios";
  if (/windows/i.test(ua)) return "windows";
  if (/macintosh|mac os x/i.test(ua)) return "mac";
  return "other";
}

/** What to tell the student about their voice: nothing when the active one is natural, "pick-natural"
 *  when a natural one is installed but not in use, else "install" with the OS to give steps for; "none"
 *  when the device has no voice for the language at all. */
export function voiceAdvice(all = refreshVoices(), { preferredURI = getPreferredVoiceURI(), lang = getLang() } = {}) {
  const prefix = lang === "sv" ? "sv" : "en";
  const forLang = all.filter((v) => normTag(v).startsWith(prefix));
  if (!forLang.length) return { kind: "none" };
  const active = chooseVoice(all, { preferredURI, lang });
  if (active && voiceIsNatural(active)) return { kind: "ok" };
  if (forLang.some(voiceIsNatural)) return { kind: "pick-natural" };
  return { kind: "install", platform: platformKind() };
}

/** Speech in sentence-sized pieces. Chrome silently stops a long utterance after ~15 s (a whole tutor
 *  reply or a reading passage), and one short chunk at a time also makes Stop respond at once. Sentences
 *  are packed together up to `max` characters, so it isn't a pause after every full stop; a sentence
 *  longer than that is cut at a comma, else a space, never mid-word. "3.14" and "t.ex." don't split:
 *  a break needs whitespace after the punctuation. */
export function splitForSpeech(text, max = 180) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (!s) return [];
  const chunks = [];
  let cur = "";
  const push = (piece) => {
    if (!cur) cur = piece;
    else if (cur.length + 1 + piece.length <= max) cur += " " + piece;
    else { chunks.push(cur); cur = piece; }
  };
  // Sentences by lookahead only: a lookbehind here is a SyntaxError in Safari before 16.4, and this
  // module is imported by the question view, so it would take the whole app down on an older iPhone.
  for (const sentence of s.match(/.+?(?:[.!?…]+(?=\s|$)|$)/g) || [s]) {
    let rest = sentence.trim();
    if (!rest) continue;
    while (rest.length > max) {
      const win = rest.slice(0, max + 1);
      let end = Math.max(win.lastIndexOf(", "), win.lastIndexOf("; "), win.lastIndexOf(": ")) + 1;  // keep the punctuation
      if (end < max * 0.4) end = win.lastIndexOf(" ");   // no useful clause break: break at a space
      if (end <= 0) end = max;                            // one unbroken run: hard cut
      push(rest.slice(0, end).trim());
      rest = rest.slice(end).trim();
    }
    if (rest) push(rest);
  }
  if (cur) chunks.push(cur);
  return chunks;
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
    // Every run in sentence-sized pieces (see splitForSpeech), each in that run's voice.
    const queue = [];
    parts.forEach((p) => {
      const v = p.bcp ? voiceForBcp(p.bcp) : pickVoice();
      splitForSpeech(p.text).forEach((text) => queue.push({ text, v, tag: p.bcp }));
    });
    queue.forEach((q, i) => {
      const u = new SpeechSynthesisUtterance(q.text);
      if (q.v) u.voice = q.v;
      u.lang = q.v?.lang || q.tag || bcp();
      u.rate = speed;
      if (i === 0 && onstart) u.onstart = onstart;
      if (i === queue.length - 1 && onend) u.onend = onend;
      u.onerror = (e) => { if (onerror) onerror(e); };
      window.speechSynthesis.speak(u);
    });
    return true;
  } catch {
    return false;
  }
}

/** Speak `text` once in a specific voice (`voiceURI`, or "" for the automatic one) at `rate` - for the
 *  "play sample" buttons, so a voice or a speed can be tried before it is saved. */
export function speakSample(text, { voiceURI = "", rate = 1, onend } = {}) {
  const clean = toSpeakable(text);
  if (!speechSupported() || !clean) return false;
  try {
    window.speechSynthesis.cancel();
    const v = voiceURI ? refreshVoices().find((x) => x.voiceURI === voiceURI) : pickVoice();
    const u = new SpeechSynthesisUtterance(clean);
    if (v) u.voice = v;
    u.lang = v?.lang || bcp();
    u.rate = Math.min(1.5, Math.max(0.5, rate));
    u.onend = () => onend?.();
    u.onerror = () => onend?.();
    window.speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}

/** The two voices for a spoken conversation: the student's own (or best) voice, and a second, different
 *  one in the same language when the device has one (null when it does not) - the best of the rest. */
export function talkVoices() {
  const first = pickVoice();
  const rest = rankVoices(voicesForLang()).filter((v) => v.voiceURI !== first?.voiceURI);
  return [first, rest[0] || null];
}

/** Read one line of a conversation as speaker 0 or 1. With a single voice installed the speakers are
 *  told apart by pitch instead. Cancels anything already speaking; false if TTS is unavailable. */
export function speakTalkLine(text, role, { rate = 1, onend, onerror } = {}) {
  const clean = toSpeakable(text);
  if (!speechSupported() || !clean) return false;
  try {
    window.speechSynthesis.cancel();
    const [a, b] = talkVoices();
    const v = role ? (b || a) : a;
    const chunks = splitForSpeech(clean);
    chunks.forEach((chunk, i) => {
      const u = new SpeechSynthesisUtterance(chunk);
      if (v) u.voice = v;
      u.lang = v?.lang || bcp();
      u.rate = Math.min(1.5, Math.max(0.5, getRate() * rate));
      if (!b) u.pitch = role ? 1.3 : 0.9;
      if (i === chunks.length - 1) u.onend = () => onend?.();
      u.onerror = (e) => onerror?.(e);
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

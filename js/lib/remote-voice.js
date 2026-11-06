// The natural read-aloud voices (Nova, Ash). The server voices each piece of library text once and keeps
// the audio (server/src/voice.js); this plays it. A piece is asked for by the SHA-256 of its text, so the
// text never leaves the device and the server voices only what the library already says. When anything
// is missing or fails - no network, the day's voice budget spent, a piece the library does not have (the
// student's own set), a browser that blocks the audio - the caller reads the rest in the device's own
// voice (speech.js speakQuestion), so reading aloud never goes quiet because of this.

import { getLang } from "./i18n.js";
import { PROXY_URL } from "../config.js";

const KEY = "studybuddy.ttsNatural";            // "nova" | "ash" | "device"
export const NATURAL_VOICES = ["nova", "ash"];
const BASE = PROXY_URL.replace(/messages$/, "voice/");   // .../api/voice/

let gate = () => false;
/** main.js says when the voices exist: the server has an OpenAI key and the student is signed in. */
export function setRemoteVoiceGate(fn) { gate = typeof fn === "function" ? fn : () => false; }

export function remoteVoiceAvailable() {
  try {
    return !!gate() && typeof Audio === "function" && typeof fetch === "function" && !!globalThis.crypto?.subtle
      && Date.now() >= downUntil;
  } catch { return false; }
}

/** The student's choice: "nova" (the default), "ash", or "device" for the device's own voice. */
export function getNaturalVoice() {
  try { const v = localStorage.getItem(KEY); return v === "ash" || v === "device" ? v : "nova"; } catch { return "nova"; }
}
export function setNaturalVoice(v) {
  try { v === "nova" ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, v); } catch {}
}
/** The natural voice to read with right now ("nova" | "ash"), or null: use the device's own. */
export function activeNaturalVoice() {
  if (!remoteVoiceAvailable()) return null;
  const v = getNaturalVoice();
  return v === "device" ? null : v;
}

// After a refusal that will not clear by itself soon (not signed in, the budget spent, the service down),
// stop trying for a minute instead of failing a request per piece.
let downUntil = 0;

let run = 0;             // bumped by every new play and every stop: an older play sees it and gives up
let active = false;
let audio = null;        // one element for everything: a browser that lets the first tap play audio lets later pieces play
let settle = null;       // resolves the piece that is playing now, so a stop does not leave it hanging
let abort = null;

export const remoteSpeaking = () => active;

export function stopRemote() {
  run++;
  active = false;
  try { abort?.abort(); } catch {}
  try { audio?.pause(); } catch {}
  settle?.();
}

/** Lowercase hex SHA-256 of `text` (UTF-8), the key the server knows a piece by. */
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 44 bytes of WAV with no samples: played once inside a tap, it lets the same element play the real audio
// later (iOS Safari only allows audio an element started from a tap).
const SILENCE = new Uint8Array([82, 73, 70, 70, 36, 0, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32, 16, 0, 0, 0, 1, 0, 1, 0,
  68, 172, 0, 0, 136, 88, 1, 0, 2, 0, 16, 0, 100, 97, 116, 97, 0, 0, 0, 0]);
let unlocked = false;
/** Call inside a tap or click, before anything is awaited. */
export function unlockAudio() {
  if (typeof Audio !== "function") return;
  audio ||= new Audio();
  if (unlocked) return;
  try {
    const url = URL.createObjectURL(new Blob([SILENCE], { type: "audio/wav" }));
    audio.src = url;
    const p = audio.play();
    unlocked = true;
    const done = () => URL.revokeObjectURL(url);
    p?.then?.(done, () => { unlocked = false; done(); });
  } catch { unlocked = false; }
}
// The first tap anywhere on the page unlocks it, so a question that reads itself aloud on arrival can too.
if (typeof document !== "undefined") {
  const first = () => { if (remoteVoiceAvailable()) { unlockAudio(); document.removeEventListener("pointerdown", first, true); } };
  document.addEventListener("pointerdown", first, true);
}

async function fetchPiece(hash, voice, lang, signal) {
  const res = await fetch(`${BASE}${hash}.mp3?voice=${voice}&lang=${lang}`, { credentials: "include", signal });
  if (!res.ok) {
    if ([401, 429, 502, 503].includes(res.status)) downUntil = Date.now() + 60_000;
    throw new Error(String(res.status));
  }
  return res.blob();
}

function playOne(url, rate) {
  return new Promise((resolve, reject) => {
    settle = resolve;
    audio.onended = () => resolve();
    audio.onerror = () => reject(new Error("audio"));
    audio.defaultPlaybackRate = rate;   // setting src resets playbackRate to this
    audio.src = url;
    audio.playbackRate = rate;
    audio.play().catch(reject);
  }).finally(() => { settle = null; });
}

/**
 * Play `pieces` (texts, as speech-pieces.js cuts a question up) one after another in `voice`.
 * Resolves { spoken, ok, cancelled }: `ok` when every piece was played, `cancelled` when a stop or a
 * newer play ended it, otherwise `spoken` pieces were played before one failed - the caller reads the rest.
 */
export async function playRemote(pieces, { voice, rate = 1, lang = getLang() } = {}) {
  stopRemote();
  const mine = run;
  const gone = () => run !== mine;
  active = true;
  abort = new AbortController();
  const signal = abort.signal;
  let spoken = 0;
  try {
    audio ||= new Audio();
    const hashes = await Promise.all(pieces.map(sha256Hex));
    if (gone()) return { spoken, ok: false, cancelled: true };
    const timed = (i) => {
      const t = setTimeout(() => abort?.abort(), 20_000);
      return fetchPiece(hashes[i], voice, lang, signal).finally(() => clearTimeout(t));
    };
    let next = timed(0);
    for (let i = 0; i < pieces.length; i++) {
      const blob = await next;
      if (gone()) return { spoken, ok: false, cancelled: true };
      next = i + 1 < pieces.length ? timed(i + 1) : null;
      next?.catch(() => {});   // a failure is dealt with when its turn comes
      const url = URL.createObjectURL(blob);
      try { await playOne(url, Math.min(1.5, Math.max(0.5, rate))); } finally { URL.revokeObjectURL(url); }
      if (gone()) return { spoken, ok: false, cancelled: true };
      spoken++;
    }
    active = false;
    return { spoken, ok: true, cancelled: false };
  } catch {
    if (gone()) return { spoken, ok: false, cancelled: true };
    active = false;
    return { spoken, ok: false, cancelled: false };
  }
}

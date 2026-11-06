// Natural read-aloud voices: the audio of a piece of library text, made once by OpenAI and kept on disk.
//
// What leaves the server is only ever text that is already in the library (data/library*): a piece is
// asked for by the SHA-256 of its text, and the server voices it only if that hash is in its own index
// of the library's pieces (js/lib/speech-pieces.js, the same function the browser uses to cut a question
// up). So a student's own text, a tutor reply or an AI-made set can never reach OpenAI through here, and
// no student data does either. The first student to hear a piece waits a moment for it; everyone after
// gets the file. If anything fails the browser falls back to the device's own voice (js/lib/remote-voice.js).
//
// Money: an estimated cost is booked per piece against a daily limit (VOICE_DAILY_CAP_KR), the disk cache
// has a size limit (VOICE_MAX_MB, oldest unused first), and the whole library voiced once in one voice and
// language is only a few dozen dollars. Dormant until OPENAI_API_KEY is set.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { libraryDir } from "./library-data.js";
import { questionPieces, OPTION_LETTERS, optionLabel } from "../../js/lib/speech-pieces.js";
import svStrings from "../../js/lib/strings.sv.js";
import enStrings from "../../js/lib/strings.en.js";

export const MODEL = "gpt-4o-mini-tts";
export const VOICES = ["nova", "ash"];
export const LANGS = ["sv", "en"];
/** Part of every file name: change the instructions below and bump this, and pieces are voiced afresh. */
export const INSTRUCTIONS_VERSION = 1;
/** Longest piece voiced. A longer one is left to the device's voice. */
export const MAX_PIECE_CHARS = 1800;

const INSTRUCTIONS = {
  sv: "Speak natural, native Swedish with correct local pronunciation and intonation, like a clear and friendly teacher reading to a student. Steady, unhurried pace.",
  en: "Speak natural, native English with correct local pronunciation and intonation, like a clear and friendly teacher reading to a student. Steady, unhurried pace.",
};
const STRINGS = { sv: svStrings, en: enStrings };

// ~ gpt-4o-mini-tts costs about $0.015 a minute; speech runs at roughly 10 characters a second, which
// makes $0.000025 a character. Deliberately a little high: the daily limit should trip early, not late.
const USD_PER_CHAR = 0.000025;
const KR_PER_USD = 10;
export const KR_PER_CHAR = USD_PER_CHAR * KR_PER_USD;

const num = (raw, dflt) => { const n = Number(raw); return raw != null && String(raw).trim() !== "" && Number.isFinite(n) && n >= 0 ? n : dflt; };
const dailyCapKr = () => num(process.env.VOICE_DAILY_CAP_KR, 15);
const maxBytes = () => num(process.env.VOICE_MAX_MB, 300) * 1024 * 1024;
const apiBase = () => String(process.env.OPENAI_API_BASE || "https://api.openai.com/v1").replace(/\/+$/, "");
const MAX_PARALLEL = 4;

export const voiceConfigured = () => !!process.env.OPENAI_API_KEY;
export const voiceDir = () => process.env.VOICE_DIR
  || path.join(path.dirname(process.env.DB_PATH || path.join(process.cwd(), "data", "x")), "voice");

export const sha256 = (text) => crypto.createHash("sha256").update(text, "utf8").digest("hex");

// ---------- the index: every piece of library text that may be voiced ----------

let index = null;   // { sv: Map(hash -> text), en: Map(hash -> text) }

/** Every piece the library's questions are read as, per language, keyed by hash. Built once, on first use. */
export function buildIndex({ dir = libraryDir() } = {}) {
  const out = { sv: new Map(), en: new Map() };
  const addText = (lang, text) => {
    if (text && text.length <= MAX_PIECE_CHARS) out[lang].set(sha256(text), text);
  };
  for (const lang of LANGS) {
    const tr = (k) => STRINGS[lang][k] ?? k;
    addText(lang, tr("voice.sampleText"));
    OPTION_LETTERS.forEach((_, i) => addText(lang, optionLabel(i)));
  }
  if (!dir) return out;
  let sets = [];
  try { sets = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8")).sets || []; } catch { return out; }
  for (const entry of sets) {
    const name = path.basename(String(entry.file || ""));
    if (!name.endsWith(".json")) continue;
    for (const [lang, folder] of [["sv", dir], ["en", path.join(dir, "..", "library-en")]]) {
      let doc;
      try { doc = JSON.parse(fs.readFileSync(path.join(folder, name), "utf8")); } catch { continue; }
      const tr = (k) => STRINGS[lang][k] ?? k;
      for (const q of doc.questions || []) for (const piece of questionPieces(q, tr)) addText(lang, piece);
    }
  }
  return out;
}

function getIndex() { return (index ??= buildIndex()); }
/** For tests: forget the built index (and the spend, queue and block state). */
export function resetVoice() { index = null; spent = { day: "", kr: 0 }; blockedUntil = 0; usedBytes = null; }

/** How many pieces a language has: shown in the log at start-up, and handy in tests. */
export const indexSize = (lang) => getIndex()[lang]?.size || 0;

// ---------- the day's spend ----------

let spent = { day: "", kr: 0 };
const today = () => new Date().toISOString().slice(0, 10);
function bookedToday() {
  if (spent.day !== today()) spent = { day: today(), kr: 0 };
  return spent.kr;
}
export const spentTodayKr = () => bookedToday();

// ---------- the disk cache ----------

let usedBytes = null;
async function cacheSize(dir) {
  if (usedBytes != null) return usedBytes;
  let total = 0;
  try { for (const f of await fsp.readdir(dir)) total += (await fsp.stat(path.join(dir, f)).catch(() => null))?.size || 0; } catch { /* no directory yet */ }
  return (usedBytes = total);
}
/** Delete the least recently used files until the cache is under 90% of its limit. */
async function evict(dir) {
  const limit = maxBytes();
  if (limit <= 0 || (await cacheSize(dir)) <= limit) return;
  const files = [];
  for (const f of await fsp.readdir(dir).catch(() => [])) {
    if (!f.endsWith(".mp3")) continue;
    const st = await fsp.stat(path.join(dir, f)).catch(() => null);
    if (st) files.push({ f, size: st.size, at: st.mtimeMs });
  }
  files.sort((a, b) => a.at - b.at);
  for (const x of files) {
    if (usedBytes <= limit * 0.9) break;
    await fsp.unlink(path.join(dir, x.f)).then(() => { usedBytes -= x.size; }).catch(() => {});
  }
}

// ---------- making one piece ----------

const inflight = new Map();   // file -> Promise, so ten students asking for the same piece make one request
let running = 0;
const waiting = [];
let blockedUntil = 0;         // after a refusal from OpenAI (bad key, no credit, rate limit) stop asking for a minute

async function slot() {
  if (running < MAX_PARALLEL) { running++; return; }
  await new Promise((r) => waiting.push(r));   // the finishing request hands its slot over without freeing it
}
function release() {
  const next = waiting.shift();
  if (next) next(); else running--;
}

async function synthesize({ voice, lang, text, fetchImpl }) {
  const res = await fetchImpl(`${apiBase()}/audio/speech`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: MODEL, voice, input: text, instructions: INSTRUCTIONS[lang], response_format: "mp3" }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    // Never log the text or the key: only what went wrong.
    if ([401, 402, 403, 429].includes(res.status)) blockedUntil = Date.now() + 60_000;
    console.warn(`[voice] OpenAI answered ${res.status}`);
    throw Object.assign(new Error("upstream"), { upstream: true });
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * The mp3 for a piece: { file } to send, or { error } with one of
 *   "disabled"  no OpenAI key, or an unknown voice / language
 *   "unknown"   the hash is not a piece of the library
 *   "cap"       today's voice budget is spent
 *   "upstream"  OpenAI did not deliver (try again later)
 */
export async function audioFor({ voice, lang, hash, fetchImpl = fetch }) {
  if (!voiceConfigured() || !VOICES.includes(voice) || !LANGS.includes(lang)) return { error: "disabled" };
  const text = getIndex()[lang].get(hash);
  if (!text) return { error: "unknown" };
  const dir = voiceDir();
  const file = path.join(dir, `${MODEL}-${voice}-${lang}-v${INSTRUCTIONS_VERSION}-${hash}.mp3`);
  try {
    const now = new Date();
    await fsp.utimes(file, now, now);   // a hit: the newest file for eviction
    return { file };
  } catch { /* not made yet */ }

  const cost = text.length * KR_PER_CHAR;
  if (bookedToday() + cost > dailyCapKr()) return { error: "cap" };
  if (Date.now() < blockedUntil) return { error: "upstream" };

  if (!inflight.has(file)) {
    const job = (async () => {
      await slot();
      try {
        // The day's budget is booked before the request goes out, so the ones waiting in the queue count.
        spent.kr += cost;
        const buf = await synthesize({ voice, lang, text, fetchImpl });
        await fsp.mkdir(dir, { recursive: true });
        const before = await cacheSize(dir);   // counted before the new file lands, so it is not added twice
        const tmp = `${file}.${process.pid}.tmp`;
        await fsp.writeFile(tmp, buf);
        await fsp.rename(tmp, file);
        usedBytes = before + buf.length;
        evict(dir).catch(() => {});
        return file;
      } catch (e) {
        spent.kr = Math.max(0, spent.kr - cost);   // nothing was made: give the money back
        throw e;
      } finally { release(); }
    })();
    inflight.set(file, job);
    job.then(() => inflight.delete(file), () => inflight.delete(file));
  }
  try {
    return { file: await inflight.get(file) };
  } catch {
    return { error: "upstream" };
  }
}

import "./helpers.mjs";
import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

// speakQuestion (speech.js) with the natural voice (remote-voice.js): the pieces are played from the server's
// audio, and whatever cannot be had is read in the device's own voice from there on. Everything the browser
// provides is faked here: Audio (a clip that ends a moment after it starts), fetch (a table of hashes the
// "server" has), and speechSynthesis (it only records what it was asked to say).

const said = [];
const played = [];
const asked = [];
let have = new Set();   // hashes the fake server has audio for

globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
globalThis.speechSynthesis = {
  speak: (u) => said.push(u.text), cancel() {}, getVoices: () => [], addEventListener() {}, speaking: false, pending: false,
};
globalThis.Audio = class {
  constructor() { this.playbackRate = 1; this.defaultPlaybackRate = 1; }
  pause() {}
  play() {
    if (this.src && this.src !== "blob:fake/44") played.push(this.src);   // 44 bytes: the silent unlock clip
    if (this.src) setTimeout(() => this.onended?.(), 1);
    return Promise.resolve();
  }
};
URL.createObjectURL = (b) => `blob:fake/${b.size}`;
URL.revokeObjectURL = () => {};
globalThis.fetch = async (url) => {
  const hash = /\/([0-9a-f]{64})\.mp3/.exec(String(url))?.[1];
  asked.push(hash);
  if (!have.has(hash)) return new Response("{}", { status: 404 });
  return new Response(new Blob(["fake-mp3-bytes"]), { status: 200 });
};

const sha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const t = (k) => k;
const LIB = { id: "q-test-1", kind: "mc", prompt: "Vad är huvudstaden i Sverige?", choices: ["Oslo", "Stockholm"] };
const PIECES = ["Vad är huvudstaden i Sverige?", "A.", "Oslo", "B.", "Stockholm"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Wait for a play to be over, not a fixed time: five fake clips take 5 timer ticks, and a Windows tick can be 15 ms,
// so a fixed 80 ms failed about one run in eight.
const settle = async (ms = 40) => {
  await sleep(ms);
  for (const end = Date.now() + 3000; remote?.remoteSpeaking() && Date.now() < end;) await sleep(10);
  await sleep(20);   // lets the end callback and the device-voice fallback run
};

let speech, remote;
before(async () => {
  speech = await import("../../js/lib/speech.js");
  remote = await import("../../js/lib/remote-voice.js");
  remote.setRemoteVoiceGate(() => true);
});
beforeEach(() => { said.length = 0; played.length = 0; asked.length = 0; have = new Set(PIECES.map(sha)); remote.stopRemote(); remote.setNaturalVoice("ash"); speech.setReadOptions(false); });

describe("speakQuestion with the natural voice", () => {
  test("stopping is counted, so a reading scheduled earlier can tell the student has left", () => {
    const before = speech.speechStops();
    speech.stopSpeaking();
    assert.equal(speech.speechStops(), before + 1);
    speech.speakSegments([{ text: "Hej" }]);   // starting a new reading is not a stop
    assert.equal(speech.speechStops(), before + 1);
  });

  test("leaving a screen stops the voice through the leave hooks main.js runs", async () => {
    const { runLeaveHooks } = await import("../../js/lib/leave-hooks.js");
    speech.speakQuestion(LIB, t, null, {});
    assert.equal(speech.isSpeaking(), true);
    const before = speech.speechStops();
    runLeaveHooks();
    assert.equal(speech.speechStops(), before + 1);
    assert.equal(speech.isSpeaking(), false);
  });
  test("reads the question alone by default: the answer options are not asked for", async () => {
    let ended = 0;
    assert.equal(speech.speakQuestion(LIB, t, null, { onend: () => ended++ }), true);
    await settle();
    assert.deepEqual(asked, [sha(PIECES[0])]);
    assert.equal(played.length, 1);
    assert.equal(ended, 1);
    assert.deepEqual(said, []);
  });

  test("with the option on, plays every piece in order from the server's audio and says nothing in the device voice", async () => {
    speech.setReadOptions(true);
    let ended = 0;
    let started = 0;
    assert.equal(speech.speakQuestion(LIB, t, null, { onstart: () => started++, onend: () => ended++ }), true);
    await settle();
    assert.deepEqual(asked, PIECES.map(sha));
    assert.equal(played.length, PIECES.length);
    assert.equal(ended, 1);
    assert.equal(started, 1, "onstart is called on the natural path too");
    assert.deepEqual(said, []);
  });

  test("options are asked for in the order shown, so shuffled options still match their letters", async () => {
    speech.setReadOptions(true);
    speech.speakQuestion({ ...LIB, choices: ["Stockholm", "Oslo"] }, t, null, {});
    await settle();
    assert.deepEqual(asked, ["Vad är huvudstaden i Sverige?", "A.", "Stockholm", "B.", "Oslo"].map(sha));
  });

  test("a piece the server lacks: the pieces already played stay played, the rest is read by the device", async () => {
    speech.setReadOptions(true);
    have.delete(sha("B."));
    let ended = 0;
    speech.speakQuestion(LIB, t, null, { onend: () => ended++ });
    await settle();
    assert.equal(played.length, 3, "the prompt, A. and Oslo");
    assert.deepEqual(said, ["B. Stockholm"]);
  });

  test("nothing from the server: the question is read by the device, with the options only when asked", async () => {
    have = new Set();
    speech.speakQuestion(LIB, t, null, {});
    await settle();
    assert.equal(played.length, 0);
    assert.deepEqual(said, ["Vad är huvudstaden i Sverige?"]);
    said.length = 0;
    speech.setReadOptions(true);
    speech.speakQuestion(LIB, t, null, {});
    await settle();
    assert.equal(said.length, 1);
    assert.match(said[0], /Vad är huvudstaden i Sverige?.*A. Oslo.*B. Stockholm/);
  });

  test("stopping while it plays ends it quietly: no end callback, no device voice", async () => {
    let ended = 0;
    speech.speakQuestion(LIB, t, null, { onend: () => ended++, onerror: () => ended++ });
    assert.equal(speech.isSpeaking(), true);
    speech.stopSpeaking();
    await settle();
    assert.equal(speech.isSpeaking(), false);
    assert.equal(ended, 0);
    assert.deepEqual(said, []);
  });

  test("a student's own question (not a library id) never asks the server", async () => {
    speech.speakQuestion({ ...LIB, id: "k3j2h1g4a9z0" }, t, null, {});
    await settle();
    assert.deepEqual(asked, []);
    assert.equal(said.length, 1);
  });

  test("a language set is read in the natural voice too: the foreign words are the point of it", async () => {
    let ended = 0;
    speech.speakQuestion(LIB, t, { code: "es", bcp: "es-ES" }, { onend: () => ended++ });
    await settle();
    assert.deepEqual(asked, [sha(PIECES[0])], "the question alone, by default");
    assert.equal(played.length, 1);
    assert.equal(ended, 1);
    assert.deepEqual(said, []);
  });

  test("a language set with nothing from the server falls back to the device voices, in the target language", async () => {
    have = new Set();
    speech.speakQuestion(LIB, t, { code: "es", bcp: "es-ES" }, {});
    await settle();
    assert.equal(played.length, 0);
    assert.ok(said.length >= 1);
  });

  test("choosing the device voice turns the natural one off", async () => {
    remote.setNaturalVoice("device");
    speech.speakQuestion(LIB, t, null, {});
    await settle();
    assert.deepEqual(asked, []);
    assert.equal(said.length, 1);
  });

  test("each piece is asked for in Ash, in the interface language", async () => {
    const urls = [];
    const orig = globalThis.fetch;
    globalThis.fetch = async (u, o) => { urls.push(String(u)); return orig(u, o); };
    speech.speakQuestion(LIB, t, null, {});
    await settle();
    globalThis.fetch = orig;
    assert.ok(urls.length && urls.every((u) => u.includes("voice=ash&lang=sv")), urls.join("\n"));
  });
});

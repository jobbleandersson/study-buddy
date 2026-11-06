// The natural read-aloud voices (server/src/voice.js, routes/voice.js): a piece of library text is asked for
// by the hash of its text, voiced by OpenAI once (here a fake one) and kept on disk. Nothing that is not
// in the library can be voiced, and every failure is a plain status the browser answers with the device's voice.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { startServer, makeClient } from "./harness.mjs";
import { buildIndex, MAX_PIECE_CHARS, sha256 } from "../src/voice.js";
import { questionPieces } from "../../js/lib/speech-pieces.js";
import svStrings from "../../js/lib/strings.sv.js";
import enStrings from "../../js/lib/strings.en.js";

const sha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// A stand-in for api.openai.com/v1/audio/speech: records what it was asked and answers with fake mp3 bytes.
async function startFakeOpenAI() {
  const calls = [];
  const mode = { status: 200, delayMs: 0 };
  const srv = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", async () => {
      let body = {};
      try { body = JSON.parse(raw); } catch {}
      calls.push({ url: req.url, auth: req.headers.authorization, body });
      if (mode.delayMs) await new Promise((r) => setTimeout(r, mode.delayMs));
      if (mode.status !== 200) { res.writeHead(mode.status, { "content-type": "application/json" }); res.end('{"error":{"message":"no"}}'); return; }
      res.writeHead(200, { "content-type": "audio/mpeg" });
      res.end(Buffer.from(`ID3fake:${body.voice}:${body.input}`));
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { calls, mode, base: `http://127.0.0.1:${srv.address().port}/v1`, stop: () => new Promise((r) => srv.close(r)) };
}

async function signedIn(server, email) {
  const client = makeClient(server.baseUrl);
  const r = await client.post("/api/auth/signup", { email, password: "longenough1", consent: true });
  assert.equal(r.status, 200);
  return client;
}
const getAudio = (server, client, hash, q = "voice=ash&lang=sv") =>
  fetch(`${server.baseUrl}/api/voice/${hash}.mp3?${q}`, { headers: { cookie: client.cookie || "" } });

const SAMPLE_SV = svStrings["voice.sampleText"];
const SAMPLE_EN = enStrings["voice.sampleText"];

describe("the index of voiceable text", () => {
  test("holds the library's questions in both languages, as the browser cuts them up", () => {
    const index = buildIndex();
    assert.ok(index.sv.size > 10000, `sv pieces: ${index.sv.size}`);
    assert.ok(index.en.size > 10000, `en pieces: ${index.en.size}`);
    const first = JSON.parse(fs.readFileSync(path.join(ROOT, "data/library/ak9-matematik-tal.json"), "utf8")).questions[0];
    for (const piece of questionPieces(first, (k) => svStrings[k])) assert.ok(index.sv.has(sha(piece)), `missing: ${piece}`);
    for (const text of index.sv.values()) assert.ok(text.length <= MAX_PIECE_CHARS);
  });

  test("never holds text that is not in the library", () => {
    const index = buildIndex();
    assert.equal(index.sv.has(sha("Hej, jag är din handledare. Vad vill du öva på?")), false);
    assert.equal(index.sv.has(sha256("")), false);
  });
});

describe("GET /api/voice/<hash>.mp3", () => {
  let server, fake, dir, client;
  before(async () => {
    fake = await startFakeOpenAI();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-test-"));
    server = await startServer({ OPENAI_API_KEY: "test-openai-key", OPENAI_API_BASE: fake.base, VOICE_DIR: dir });
    client = await signedIn(server, "voice@example.se");
  });
  after(async () => { await server.stop(); await fake.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

  test("the health check says the voices exist", async () => {
    const { json } = await makeClient(server.baseUrl).get("/api/health");
    assert.equal(json.voiceConfigured, true);
  });

  test("the CSP lets the page play audio from blob: URLs", async () => {
    const { res } = await client.get("/api/health");
    assert.match(res.headers.get("content-security-policy"), /media-src[^;]*'self'[^;]*blob:/);
  });

  test("needs a sign-in", async () => {
    const res = await fetch(`${server.baseUrl}/api/voice/${sha(SAMPLE_SV)}.mp3?voice=ash&lang=sv`);
    assert.equal(res.status, 401);
    assert.equal(fake.calls.length, 0);
  });

  test("voices a library piece once, in Ash, then serves the kept file", async () => {
    const hash = sha(SAMPLE_SV);
    const a = await getAudio(server, client, hash);
    assert.equal(a.status, 200);
    assert.equal(a.headers.get("content-type"), "audio/mpeg");
    assert.match(a.headers.get("cache-control"), /private/);
    assert.equal(await a.text(), `ID3fake:ash:${SAMPLE_SV}`);
    assert.equal(fake.calls.length, 1);
    const call = fake.calls[0];
    assert.equal(call.url, "/v1/audio/speech");
    assert.equal(call.auth, "Bearer test-openai-key");
    assert.equal(call.body.model, "gpt-4o-mini-tts");
    assert.equal(call.body.voice, "ash");
    assert.equal(call.body.input, SAMPLE_SV);
    assert.equal(call.body.response_format, "mp3");
    assert.equal(call.body.instructions, undefined, "no pronunciation brief: the plain voice is what rated Good on every text");

    const b = await getAudio(server, client, hash);
    assert.equal(b.status, 200);
    assert.equal(await b.text(), `ID3fake:ash:${SAMPLE_SV}`);
    assert.equal(fake.calls.length, 1, "the second ask is served from disk");
  });

  test("each language is its own file", async () => {
    const before = fake.calls.length;
    const en = await getAudio(server, client, sha(SAMPLE_EN), "voice=ash&lang=en");
    assert.equal(en.status, 200);
    assert.equal(await en.text(), `ID3fake:ash:${SAMPLE_EN}`);
    assert.equal(fake.calls.length, before + 1);
  });

  test("a real library question is voiceable, option by option", async () => {
    const q = JSON.parse(fs.readFileSync(path.join(ROOT, "data/library/ak9-matematik-tal.json"), "utf8")).questions[0];
    const before = fake.calls.length;
    for (const piece of questionPieces(q, (k) => svStrings[k])) {
      const res = await getAudio(server, client, sha(piece));
      assert.equal(res.status, 200, `piece: ${piece}`);
      await res.arrayBuffer();
    }
    assert.ok(fake.calls.length > before);
  });

  test("text that is not in the library is never sent to OpenAI", async () => {
    const before = fake.calls.length;
    for (const text of ["Hej, jag är din handledare.", "Min egen fråga om kemi", ""]) {
      const res = await getAudio(server, client, sha(text));
      assert.equal(res.status, 404);
      assert.equal((await res.json()).error.code, "voice_unknown");
    }
    assert.equal(fake.calls.length, before);
  });

  test("an unknown voice or language, or a malformed hash, is refused", async () => {
    const before = fake.calls.length;
    assert.equal((await getAudio(server, client, sha(SAMPLE_SV), "voice=alloy&lang=sv")).status, 404);
    assert.equal((await getAudio(server, client, sha(SAMPLE_SV), "voice=nova&lang=sv")).status, 404, "Nova rated Weak and is not offered");
    assert.equal((await getAudio(server, client, sha(SAMPLE_SV), "voice=ash&lang=es")).status, 404);
    assert.equal((await getAudio(server, client, "../../etc/passwd")).status, 404);
    assert.equal((await getAudio(server, client, "abc")).status, 404);
    assert.equal(fake.calls.length, before);
  });

  test("students asking for the same new piece at once cause one request", async () => {
    const q = JSON.parse(fs.readFileSync(path.join(ROOT, "data/library/ak9-matematik-tal.json"), "utf8")).questions[1];
    const piece = questionPieces(q, (k) => svStrings[k])[0];
    fake.mode.delayMs = 150;
    const before = fake.calls.length;
    const all = await Promise.all([1, 2, 3, 4, 5].map(() => getAudio(server, client, sha(piece), "voice=ash&lang=sv")));
    fake.mode.delayMs = 0;
    assert.deepEqual(all.map((r) => r.status), [200, 200, 200, 200, 200]);
    assert.equal(fake.calls.length, before + 1);
  });

  test("OpenAI failing is a 502 that leaves nothing behind, and the next try voices it", async () => {
    const q = JSON.parse(fs.readFileSync(path.join(ROOT, "data/library/ak9-matematik-tal.json"), "utf8")).questions[2];
    const piece = questionPieces(q, (k) => svStrings[k])[0];
    fake.mode.status = 500;
    const bad = await getAudio(server, client, sha(piece));
    assert.equal(bad.status, 502);
    fake.mode.status = 200;
    const good = await getAudio(server, client, sha(piece));
    assert.equal(good.status, 200);
  });

  test("a refusal from OpenAI (bad key, no credit) pauses new requests instead of repeating them", async () => {
    const qs = JSON.parse(fs.readFileSync(path.join(ROOT, "data/library/ak9-matematik-tal.json"), "utf8")).questions;
    const p1 = questionPieces(qs[3], (k) => svStrings[k])[0];
    const p2 = questionPieces(qs[4], (k) => svStrings[k])[0];   // two prompts nobody has asked for yet
    fake.mode.status = 401;
    const before = fake.calls.length;
    assert.equal((await getAudio(server, client, sha(p1))).status, 502);
    assert.equal((await getAudio(server, client, sha(p2))).status, 502);
    fake.mode.status = 200;
    assert.equal(fake.calls.length, before + 1, "the second piece was not even tried");
  });
});

describe("limits and dormancy", () => {
  test("without OPENAI_API_KEY nothing is voiced and the health check says so", async () => {
    const server = await startServer({ OPENAI_API_KEY: "" });
    try {
      const client = await signedIn(server, "nokey@example.se");
      assert.equal((await client.get("/api/health")).json.voiceConfigured, false);
      assert.equal((await getAudio(server, client, sha(SAMPLE_SV))).status, 404);
    } finally { await server.stop(); }
  });

  test("a spent day budget answers 503 and sends nothing", async () => {
    const fake = await startFakeOpenAI();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-test-"));
    const server = await startServer({ OPENAI_API_KEY: "k", OPENAI_API_BASE: fake.base, VOICE_DIR: dir, VOICE_DAILY_CAP_KR: "0.001" });
    try {
      const client = await signedIn(server, "cap@example.se");
      const res = await getAudio(server, client, sha(SAMPLE_SV));
      assert.equal(res.status, 503);
      assert.equal((await res.json()).error.code, "voice_cap");
      assert.equal(fake.calls.length, 0);
    } finally { await server.stop(); await fake.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  const kr = (text) => text.length * 0.000025 * 10;   // voice.js's estimate: $0.000025 a character, 10 kr to the dollar

  test("one account cannot spend more than its share of the day on new audio; others and made pieces are unaffected", async () => {
    const fake = await startFakeOpenAI();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-test-"));
    const server = await startServer({ OPENAI_API_KEY: "k", OPENAI_API_BASE: fake.base, VOICE_DIR: dir, VOICE_USER_DAILY_KR: String(kr(SAMPLE_SV) * 1.5) });
    try {
      const a = await signedIn(server, "share-a@example.se");
      const b = await signedIn(server, "share-b@example.se");
      assert.equal((await getAudio(server, a, sha(SAMPLE_SV))).status, 200, "the first new piece fits");
      const over = await getAudio(server, a, sha(SAMPLE_EN), "voice=ash&lang=en");
      assert.equal(over.status, 503, "the second would go over A's share");
      assert.equal((await over.json()).error.code, "voice_cap");
      const calls = fake.calls.length;
      assert.equal((await getAudio(server, a, sha(SAMPLE_SV))).status, 200, "a piece already made is free");
      assert.equal(fake.calls.length, calls);
      assert.equal((await getAudio(server, b, sha(SAMPLE_EN), "voice=ash&lang=en")).status, 200, "another account still has its own share");
    } finally { await server.stop(); await fake.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test("a piece already being made is served even when the budget has no room for another", async () => {
    const fake = await startFakeOpenAI();
    fake.mode.delayMs = 200;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-test-"));
    const server = await startServer({ OPENAI_API_KEY: "k", OPENAI_API_BASE: fake.base, VOICE_DIR: dir, VOICE_DAILY_CAP_KR: String(kr(SAMPLE_SV) * 1.2) });
    try {
      const a = await signedIn(server, "flight-a@example.se");
      const b = await signedIn(server, "flight-b@example.se");
      const [ra, rb] = await Promise.all([getAudio(server, a, sha(SAMPLE_SV)), getAudio(server, b, sha(SAMPLE_SV))]);
      assert.deepEqual([ra.status, rb.status], [200, 200]);
      assert.equal(fake.calls.length, 1);
    } finally { await server.stop(); await fake.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test("the disk cache keeps to its size, oldest files first", async () => {
    const fake = await startFakeOpenAI();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-test-"));
    const server = await startServer({ OPENAI_API_KEY: "k", OPENAI_API_BASE: fake.base, VOICE_DIR: dir, VOICE_MAX_MB: "0.0003" });   // about 300 bytes
    try {
      const client = await signedIn(server, "disk@example.se");
      const q = JSON.parse(fs.readFileSync(path.join(ROOT, "data/library/ak9-matematik-tal.json"), "utf8")).questions[0];
      for (const piece of questionPieces(q, (k) => svStrings[k])) await (await getAudio(server, client, sha(piece))).arrayBuffer();
      let total = Infinity;
      for (let i = 0; i < 40 && total > 330; i++) {
        await new Promise((r) => setTimeout(r, 50));
        total = fs.readdirSync(dir).reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0);
      }
      assert.ok(total <= 330, `cache is ${total} bytes`);
    } finally { await server.stop(); await fake.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

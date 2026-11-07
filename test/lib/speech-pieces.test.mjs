import "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toSpeakable, questionPieces, optionLabel } from "../../js/lib/speech-pieces.js";
import { toSpeakable as fromSpeech } from "../../js/lib/speech.js";
import {
  sha256Hex, remoteVoiceAvailable, activeNaturalVoice, getNaturalVoice, setNaturalVoice, setRemoteVoiceGate, remoteSpeaking,
} from "../../js/lib/remote-voice.js";

const tr = (k) => ({ "q.readBlankWord": "lucka", "hp.kvaColI": "Kvantitet I", "hp.kvaColII": "Kvantitet II", "hp.speakFigure": "Figur" })[k] ?? k;

describe("questionPieces", () => {
  test("a multiple-choice question is the prompt, then a label and the text of each option", () => {
    const q = { kind: "mc", prompt: "Vad är $-7 - (-2)$?", choices: ["-5", "5", "9"] };
    assert.deepEqual(questionPieces(q, tr), ["Vad är -7 - (-2) ?", "A.", "-5", "B.", "5", "C.", "9"]);
  });

  test("shuffling the options changes only their order, never what each piece says", () => {
    const base = { kind: "mc", prompt: "P", choices: ["ett", "två", "tre"] };
    const shuffled = { ...base, choices: ["tre", "ett", "två"] };
    assert.deepEqual([...questionPieces(base, tr)].sort(), [...questionPieces(shuffled, tr)].sort());
    assert.deepEqual(questionPieces(shuffled, tr).filter((_, i) => i % 2 === 1), ["A.", "B.", "C."]);
  });

  test("a cloze says the blank word for each gap", () => {
    assert.deepEqual(questionPieces({ kind: "cloze", prompt: "Huvudstaden är {{Stockholm}} i {{Sverige}}." }, tr),
      ["Huvudstaden är lucka i lucka ."]);
  });

  test("a short-answer or flashcard question is just its prompt", () => {
    assert.deepEqual(questionPieces({ kind: "short", prompt: "Vad heter glukos i växter?" }, tr), ["Vad heter glukos i växter?"]);
    assert.deepEqual(questionPieces({ kind: "flashcard", prompt: "Mitos" }, tr), ["Mitos"]);
  });

  test("högskoleprov framing is read first, one piece each", () => {
    const q = { kind: "mc", prompt: "Vilket gäller?", choices: ["a", "b"], stimulus: { quantities: ["x + 1", "x - 1"], given: "x är positivt" }, figure: { alt: "En graf" } };
    assert.deepEqual(questionPieces(q, tr).slice(0, 4), ["Kvantitet I: x + 1.", "Kvantitet II: x - 1.", "hp.kvaGivenLabel x är positivt.", "Figur: En graf."]);
  });

  test("nothing in, nothing out", () => {
    assert.deepEqual(questionPieces(null, tr), []);
    assert.deepEqual(questionPieces({ kind: "short", prompt: "  " }, tr), []);
  });

  test("labels run A to F, then count", () => {
    assert.deepEqual([0, 1, 5, 6].map(optionLabel), ["A.", "B.", "F.", "7."]);
  });

  test("toSpeakable is the same function from speech.js", () => {
    assert.equal(fromSpeech, toSpeakable);
    assert.equal(toSpeakable("**fet** och `kod` och [länk](https://x.se)"), "fet och kod och länk");
  });

  test("every question in the library can be cut up, and no piece is empty", () => {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "library");
    let n = 0;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json") && !x.startsWith("index"))) {
      for (const q of JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).questions || []) {
        const pieces = questionPieces(q, tr);
        assert.ok(pieces.length > 0, `${f} ${q.id}`);
        assert.ok(pieces.every((p) => p.trim() === p && p), `${f} ${q.id}`);
        n++;
      }
    }
    assert.ok(n > 4000, `questions: ${n}`);
  });
});

describe("remote-voice", () => {
  test("sha256Hex matches the hash the server computes, åäö included", async () => {
    for (const text of ["abc", "Fotosyntesen omvandlar ljus, vatten och koldioxid.", "Åsa ä ö — “citat”"]) {
      assert.equal(await sha256Hex(text), crypto.createHash("sha256").update(text, "utf8").digest("hex"));
    }
  });

  test("it is off until the gate says the voices exist", () => {
    assert.equal(remoteVoiceAvailable(), false);
    assert.equal(activeNaturalVoice(), null);
    assert.equal(remoteSpeaking(), false);
  });

  test("the choice defaults to Ash and remembers the device's own voice", () => {
    localStorage.removeItem("studybuddy.ttsNatural");
    assert.equal(getNaturalVoice(), "ash");
    setNaturalVoice("device");
    assert.equal(getNaturalVoice(), "device");
    setNaturalVoice("ash");
    assert.equal(getNaturalVoice(), "ash");
    localStorage.setItem("studybuddy.ttsNatural", "nova");
    assert.equal(getNaturalVoice(), "ash", "a stored value from an earlier voice reads as the default");
    setNaturalVoice("something-else");
    assert.equal(getNaturalVoice(), "ash", "a value that is not a voice reads as the default");
  });

  test("a device voice the student had already picked stays their choice until they pick Ash", () => {
    localStorage.removeItem("studybuddy.ttsNatural");
    localStorage.setItem("studybuddy.ttsVoice", "Microsoft Sofie Online");
    assert.equal(getNaturalVoice(), "device");
    setNaturalVoice("ash");
    assert.equal(getNaturalVoice(), "ash", "choosing Ash is explicit and wins");
    localStorage.removeItem("studybuddy.ttsVoice");
    localStorage.removeItem("studybuddy.ttsNatural");
  });

  test("the answer options are read only when the student asks for them", async () => {
    const speech = await import("../../js/lib/speech.js");
    localStorage.removeItem("studybuddy.ttsOptions");
    assert.equal(speech.getReadOptions(), false, "off by default");
    speech.setReadOptions(true);
    assert.equal(speech.getReadOptions(), true);
    speech.setReadOptions(false);
    assert.equal(speech.getReadOptions(), false);
    const q = { kind: "mc", prompt: "Vad är 2 + 2?", choices: ["3", "4"] };
    assert.deepEqual(questionPieces(q, tr, { options: false }), ["Vad är 2 + 2?"]);
    assert.deepEqual(questionPieces(q, tr), ["Vad är 2 + 2?", "A.", "3", "B.", "4"], "the default, which the server's index uses, stays whole");
    assert.equal(speech.questionToSpeech(q, null, { options: false }), "Vad är 2 + 2?");
    assert.match(speech.questionToSpeech(q, null), /A. 3. B. 4/);
  });

  test("a gate that throws or says no keeps it off", () => {
    setRemoteVoiceGate(() => { throw new Error("x"); });
    assert.equal(remoteVoiceAvailable(), false);
    setRemoteVoiceGate(() => false);
    assert.equal(remoteVoiceAvailable(), false);
  });
});

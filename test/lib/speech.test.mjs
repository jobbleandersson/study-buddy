import "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  voiceScore, rankVoices, chooseVoice, voiceAdvice, platformKind, splitForSpeech,
  voiceIsNatural, voiceIsOnline, pickTalkVoices,
} from "../../js/lib/speech.js";

// A fake SpeechSynthesisVoice: name doubles as its voiceURI.
const V = (name, lang, local = true) => ({ name, lang, voiceURI: name, localService: local });
const BENGT = V("Microsoft Bengt - Swedish", "sv-SE");
const HEDVIG = V("Microsoft Hedvig - Swedish", "sv-SE");
const ALVA = V("Alva (Enhanced)", "sv-SE");
const SOFIE = V("Microsoft Sofie Online (Natural) - Swedish (Sweden)", "sv-SE", false);
const ESPEAK = V("eSpeak Swedish", "sv");
const GB = V("Microsoft George - English (United Kingdom)", "en-GB");

describe("voice ranking", () => {
  test("natural and online are read off the voice", () => {
    assert.equal(voiceIsNatural(SOFIE), true);
    assert.equal(voiceIsNatural(ALVA), true);
    assert.equal(voiceIsNatural(BENGT), false);
    assert.equal(voiceIsOnline(SOFIE), true);
    assert.equal(voiceIsOnline(BENGT), false);
  });

  test("on-device beats online (the automatic choice stays private), natural beats basic, robotic is last of the local ones", () => {
    const order = rankVoices([SOFIE, ESPEAK, HEDVIG, ALVA, BENGT], "sv").map((v) => v.name);
    assert.equal(order[0], "Alva (Enhanced)");                         // natural + local
    assert.deepEqual(order.slice(1, 3), [BENGT.name, HEDVIG.name]);     // basic local, ties broken by name
    assert.ok(order.indexOf(ESPEAK.name) > order.indexOf(HEDVIG.name), "eSpeak ranks below a proper local voice");
    assert.ok(order.indexOf(SOFIE.name) > order.indexOf(ESPEAK.name), "an online voice is never picked over a local one");
  });

  test("the exact locale beats another region, and rankVoices does not mutate its input", () => {
    const gb = V("Voice A", "en-GB"), us = V("Voice B", "en-US"), au = V("Voice C", "en-AU");
    const input = [au, us, gb];
    assert.deepEqual(rankVoices(input, "en").map((v) => v.name), ["Voice A", "Voice B", "Voice C"]);
    assert.deepEqual(input.map((v) => v.name), ["Voice C", "Voice B", "Voice A"]);
    assert.ok(voiceScore(BENGT, "sv") > voiceScore(V("Other", "sv-FI"), "sv"));
  });
});

describe("choosing the voice", () => {
  const all = [GB, BENGT, SOFIE, ALVA];

  test("takes the best voice for the language when the student has not picked one", () => {
    assert.equal(chooseVoice(all, { lang: "sv" }).name, "Alva (Enhanced)");
    assert.equal(chooseVoice(all, { lang: "en" }).name, GB.name);
  });

  test("honours the student's pick, even an online one, while it is still installed", () => {
    assert.equal(chooseVoice(all, { preferredURI: SOFIE.voiceURI, lang: "sv" }), SOFIE);
  });

  test("falls back to the best voice when the picked one is gone, and to null when the language has none", () => {
    assert.equal(chooseVoice(all, { preferredURI: "uninstalled", lang: "sv" }).name, "Alva (Enhanced)");
    assert.equal(chooseVoice([GB], { lang: "sv" }), null);
    assert.equal(chooseVoice([], { lang: "sv" }), null);
  });
});

describe("pickTalkVoices (Alex and Sam)", () => {
  const all = [BENGT, HEDVIG, ALVA, SOFIE, GB];
  const names = (pair) => pair.map((v) => v && v.name);

  test("by default Alex gets the best voice and Sam the best of the rest", () => {
    assert.deepEqual(names(pickTalkVoices(all, { lang: "sv" })), [ALVA.name, BENGT.name]);
  });

  test("Alex follows the student's general voice; Sam is then a different one", () => {
    assert.deepEqual(names(pickTalkVoices(all, { preferredURI: HEDVIG.voiceURI, lang: "sv" })), [HEDVIG.name, ALVA.name]);
  });

  test("a voice picked for each speaker is used, even an online one", () => {
    assert.deepEqual(names(pickTalkVoices(all, { a: SOFIE.voiceURI, s: HEDVIG.voiceURI, lang: "sv" })), [SOFIE.name, HEDVIG.name]);
  });

  test("picking only Sam's voice leaves Alex on automatic", () => {
    assert.deepEqual(names(pickTalkVoices(all, { s: BENGT.voiceURI, lang: "sv" })), [ALVA.name, BENGT.name]);
    assert.deepEqual(names(pickTalkVoices(all, { s: SOFIE.voiceURI, lang: "sv" })), [ALVA.name, SOFIE.name]);
  });

  test("the same voice picked for both is honoured (the player then tells them apart by pitch)", () => {
    assert.deepEqual(names(pickTalkVoices(all, { a: BENGT.voiceURI, s: BENGT.voiceURI, lang: "sv" })), [BENGT.name, BENGT.name]);
  });

  test("a picked voice that is no longer installed falls back to automatic", () => {
    assert.deepEqual(names(pickTalkVoices(all, { a: "gone", s: "gone", lang: "sv" })), [ALVA.name, BENGT.name]);
  });

  test("with one voice Sam is null, and with none both are", () => {
    assert.deepEqual(names(pickTalkVoices([BENGT], { lang: "sv" })), [BENGT.name, null]);
    assert.deepEqual(names(pickTalkVoices([GB], { lang: "sv" })), [null, null]);
  });
});

describe("voice advice", () => {
  test("nothing to say while the voice in use is natural", () => {
    assert.deepEqual(voiceAdvice([BENGT, ALVA], { lang: "sv" }), { kind: "ok" });
    assert.deepEqual(voiceAdvice([BENGT, SOFIE], { preferredURI: SOFIE.voiceURI, lang: "sv" }), { kind: "ok" });
  });

  test("points at a natural voice that is installed but not in use", () => {
    assert.deepEqual(voiceAdvice([BENGT, SOFIE], { preferredURI: BENGT.voiceURI, lang: "sv" }), { kind: "pick-natural" });
    assert.deepEqual(voiceAdvice([BENGT, SOFIE], { lang: "sv" }), { kind: "pick-natural" });   // auto picks the local basic one
  });

  test("tells the student how to install one when the device has only basic voices", () => {
    const a = voiceAdvice([BENGT], { lang: "sv" });
    assert.equal(a.kind, "install");
    assert.ok(["windows", "mac", "ios", "android", "other"].includes(a.platform));
  });

  test("says so when the device has no voice for the language", () => {
    assert.deepEqual(voiceAdvice([GB], { lang: "sv" }), { kind: "none" });
    assert.deepEqual(voiceAdvice([], { lang: "en" }), { kind: "none" });
  });
});

describe("platformKind", () => {
  const UA = {
    windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
    mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36",
    linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
  };

  test("recognises the common systems", () => {
    assert.equal(platformKind(UA.windows, 0), "windows");
    assert.equal(platformKind(UA.mac, 0), "mac");
    assert.equal(platformKind(UA.iphone, 5), "ios");
    assert.equal(platformKind(UA.android, 5), "android");
    assert.equal(platformKind(UA.linux, 0), "other");
    assert.equal(platformKind("", 0), "other");
  });

  test("an iPad that reports a Mac user agent is told apart by its touch screen", () => {
    assert.equal(platformKind(UA.mac, 5), "ios");
    assert.equal(platformKind(UA.mac, 0), "mac");
  });
});

describe("splitForSpeech", () => {
  const words = (n, w = "ord") => Array.from({ length: n }, () => w).join(" ");

  test("nothing in, nothing out; short text stays one piece with its spacing tidied", () => {
    assert.deepEqual(splitForSpeech(""), []);
    assert.deepEqual(splitForSpeech(null), []);
    assert.deepEqual(splitForSpeech("  Hej   där.  "), ["Hej där."]);
  });

  test("sentences are packed together up to the limit, not one piece per full stop", () => {
    assert.deepEqual(splitForSpeech("Ett. Två. Tre."), ["Ett. Två. Tre."]);
    const s = `${words(20)}. ${words(20)}. ${words(20)}.`;      // three ~80-character sentences
    const out = splitForSpeech(s, 180);
    assert.equal(out.length, 2);
    assert.ok(out.every((c) => c.length <= 180));
    assert.equal(out.join(" "), s);
  });

  test("a long sentence is cut at a comma, keeping the comma, and never inside a word", () => {
    const s = Array.from({ length: 60 }, (_, i) => `del${i},`).join(" ");   // one 400-odd character sentence
    const out = splitForSpeech(s, 100);
    assert.ok(out.length >= 4);
    assert.ok(out.every((c) => c.length <= 100), out.map((c) => c.length).join(","));
    assert.ok(out.slice(0, -1).every((c) => c.endsWith(",")), "each cut lands after a comma");
    assert.equal(out.join(" "), s);
  });

  test("with no comma it cuts at a space", () => {
    const s = words(80);
    const out = splitForSpeech(s, 100);
    assert.ok(out.every((c) => c.length <= 100));
    assert.equal(out.join(" "), s);
  });

  test("one unbroken run is hard-cut at the limit rather than dropped", () => {
    const out = splitForSpeech("a".repeat(450), 100);
    assert.equal(out.length, 5);
    assert.ok(out.every((c) => c.length <= 100));
    assert.equal(out.join(""), "a".repeat(450));
  });

  test("a full stop inside a number or an abbreviation is not a sentence break", () => {
    assert.deepEqual(splitForSpeech("Pi är 3.14 ungefär, t.ex. i cirklar."), ["Pi är 3.14 ungefär, t.ex. i cirklar."]);
    const out = splitForSpeech("Pi är ungefär 3.14159 och e är 2.71828 ganska exakt. Klart.", 40);
    assert.ok(out.join(" ").includes("3.14159") && out.join(" ").includes("2.71828"));
    assert.ok(out.every((c) => !c.endsWith("3.") && !c.endsWith("2.")), "never ends right after '3.' or '2.'");
  });

  test("question marks, exclamations and ellipses end a sentence", () => {
    const out = splitForSpeech(`${words(15)}? ${words(15)}! ${words(15)}… ${words(15)}.`, 100);
    assert.ok(out.length >= 3);
    assert.ok(out.every((c) => c.length <= 100));
  });
});

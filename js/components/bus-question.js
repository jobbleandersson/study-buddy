// Bussläge: one multiple-choice question, read aloud and answered by voice (or
// by tapping). Same contract as the renderers in questions.js — returns
// { el, result, handleKey, cleanup } and calls opts.onDone(result) once — but
// it also runs the conversation: read the question, listen, say whether it was
// right, and move on by itself (opts.advance).
//
// Speech is the browser's own. Reading uses speechSynthesis, on the device.
// Listening uses SpeechRecognition, and that is the part to be straight about:
// in Chrome and Edge the audio normally goes to the browser maker's service to
// be turned into text, it needs microphone permission, and it stops when the
// screen locks. So a voice answer is always optional, tapping an option always
// works, and every failure lands on tapping with a plain-language note.

import { el, icon, ICONS } from "../lib/dom.js";
import { t, getLang } from "../lib/i18n.js";
import { fromCorrect } from "../lib/srs.js";
import { renderRich } from "../lib/rich.js";
import { choicesAreTarget } from "../lib/lang-detect.js";
import {
  speechSupported, speakSegments, stopSpeaking, questionToSegments, toSpeakable,
  recognitionSupported, listenOnce,
} from "../lib/speech.js";
import { parseSpokenChoice } from "../lib/voice-answer.js";

const VOICE_KEY = "studybuddy.busVoice";
const bcp = () => (getLang() === "sv" ? "sv-SE" : "en-GB");

export function getBusVoice() {
  try { return localStorage.getItem(VOICE_KEY) !== "0"; } catch { return true; }
}
function setBusVoice(on) {
  try { localStorage.setItem(VOICE_KEY, on ? "1" : "0"); } catch { /* private mode — fine */ }
}

/** Which questions can be done by ear: plain multiple choice, with nothing to
 *  look at (no figure, no shared passage, no Högskoleprov layout). */
export function isBusQuestion(q) {
  return !!q && q.kind === "mc" && Array.isArray(q.choices) && q.choices.length >= 2 && q.choices.length <= 6
    && !q.figure && !q.stimulus && !q.variant;
}

// The first question of a session waits for a tap — browsers only let a page
// speak, and ask for the microphone, after the person has touched it. After
// that the whole set runs hands-free. Reset when the session is left.
let primed = false;
export function resetBusPrime() { primed = false; }

const letterOf = (i) => String.fromCharCode(65 + i);
const listOf = (items) => (items.length < 2 ? items.join("")
  : `${items.slice(0, -1).join(", ")} ${t("bus.or")} ${items[items.length - 1]}`);

/** The first sentence or two of an explanation, short enough to listen to. */
function shortExplanation(text) {
  const plain = toSpeakable(text);
  if (!plain) return "";
  const sentences = plain.match(/[^.!?]+[.!?]+/g) || [plain];
  let out = "";
  for (const s of sentences) {
    if ((out + s).length > 220 && out) break;
    out += s;
  }
  return out.trim();
}

/**
 * opts: { question, targetLang, progress: {n,total}, onDone, advance, skip }
 *   advance() moves to the next question; skip() saves this one for later and
 *   returns false when it can't be skipped (the last one left).
 */
export function renderBusQuestion({ question, targetLang = null, progress = null, onDone, advance, skip }) {
  const speechOn = speechSupported();
  const canListen = recognitionSupported();
  let voiceOn = canListen && getBusVoice();
  let phase = primed ? "reading" : "start";   // start | reading | listening | idle | feedback | paused
  let runId = 0;                              // bumps on every action; stale callbacks compare against it
  let done = false, destroyed = false, misses = 0;
  let listener = null;
  const timers = new Set();

  const result = { correct: false, hintsUsed: 0 };
  const letters = question.choices.map((_, i) => letterOf(i));
  const alive = (id) => !destroyed && id === runId;
  const later = (fn, ms) => { const h = setTimeout(() => { timers.delete(h); fn(); }, ms); timers.add(h); };
  const clearTimers = () => { timers.forEach(clearTimeout); timers.clear(); };
  const stopListening = () => { try { listener?.stop(); } catch { /* already stopped */ } listener = null; };

  /* ---------------- markup ---------------- */
  const optBtns = question.choices.map((c, i) => el("button.bus-opt", {
    type: "button", onclick: () => answer(i),
  }, [el("span.bus-opt__key", {}, letters[i]), el("span.bus-opt__text", { html: renderRich(c) })]));

  const status = el("p.bus__status", { role: "status", "aria-live": "polite" });
  const note = el("p.bus__note", { role: "status", "aria-live": "polite" });
  const orb = el("button.bus-orb", { type: "button", onclick: onOrb }, [icon(ICONS.mic, 32)]);
  const wave = el("div.bus-wave", { "aria-hidden": "true" }, Array.from({ length: 14 }, (_, i) => el("i", { style: { "--i": String(i) } })));
  const repeatBtn = el("button.btn.btn--ghost.btn--sm.bus__ctl", { type: "button", onclick: () => { if (!done) readQuestion(); } }, t("bus.repeat"));
  const skipBtn = el("button.btn.btn--ghost.btn--sm.bus__ctl", { type: "button", onclick: doSkip }, t("bus.skip"));
  const pauseBtn = el("button.btn.btn--ghost.btn--sm.bus__ctl", { type: "button", onclick: onPause });
  const voiceBtn = canListen ? el("button.bus__toggle", {
    type: "button", role: "switch", onclick: toggleVoice,
  }, [el("span.bus__toggle-dot", { "aria-hidden": "true" }), el("span", {}, t("bus.voiceToggle"))]) : null;

  const startCard = el("div.bus__start", {}, [
    el("button.btn.bus__go", { type: "button", onclick: start }, [icon(ICONS.headphones, 20), t("bus.startCta")]),
    el("p", {}, t("bus.startHint")),
    canListen && voiceOn ? el("p.bus__privacy", {}, t("bus.privacy")) : null,
    !speechOn ? el("p.bus__privacy", {}, t("bus.noSpeech")) : null,
    !canListen ? el("p.bus__privacy", {}, t("bus.noRecognition")) : null,
  ].filter(Boolean));

  const voicePanel = el("div.bus__voice", {}, [orb, wave, status, note]);
  const controls = el("div.bus__controls", {}, [repeatBtn, skipBtn, pauseBtn]);

  const node = el("div.bus.theme-night", {}, [
    el("div.bus__top", {}, [
      el("span.bus__chip", {}, [icon(ICONS.headphones, 16), t("bus.title")]),
      progress ? el("span.bus__count", {}, t("bus.progress", progress)) : null,
    ].filter(Boolean)),
    el("div.bus__q", { html: renderRich(question.prompt) }),
    el("div.bus__opts", { role: "group", "aria-label": t("bus.optionsLabel") }, optBtns),
    startCard,
    voicePanel,
    controls,
    voiceBtn ? el("div.bus__prefs", {}, [voiceBtn]) : null,
  ].filter(Boolean));

  /* ---------------- painting ---------------- */
  function paint() {
    node.dataset.phase = phase;
    startCard.hidden = phase !== "start";
    voicePanel.hidden = phase === "start";
    controls.hidden = phase === "start";
    orb.hidden = !voiceOn;
    wave.hidden = !voiceOn;
    orb.classList.toggle("is-listening", phase === "listening");
    orb.classList.toggle("is-busy", phase === "reading" || phase === "feedback");
    orb.setAttribute("aria-label", phase === "listening" ? t("bus.orbStop") : phase === "paused" ? t("bus.resume") : t("bus.orbListen"));
    wave.classList.toggle("is-on", phase === "listening");
    repeatBtn.disabled = done;
    skipBtn.disabled = done;
    pauseBtn.textContent = phase === "paused" ? t("bus.resume") : t("bus.pause");
    pauseBtn.disabled = phase === "start";
    if (voiceBtn) voiceBtn.setAttribute("aria-checked", String(voiceOn));
    node.classList.toggle("bus--voice-off", !voiceOn);
    status.textContent = phase === "reading" ? t("bus.reading")
      : phase === "listening" ? t("bus.listening", { letters: listOf(letters) })
      : phase === "paused" ? t("bus.paused")
      : phase === "idle" ? t("bus.idle")
      : "";
  }
  function setPhase(p) { phase = p; paint(); }
  function say(msg) { note.textContent = msg || ""; }

  function paintOptions(picked) {
    optBtns.forEach((b, i) => {
      b.disabled = true;
      if (i === question.answer) b.classList.add("is-correct");
      else if (i === picked) b.classList.add("is-wrong");
    });
  }

  /* ---------------- speaking ---------------- */
  /** Speak, then call `then` once — even if the browser can't speak at all. */
  function speak(segments, then) {
    const id = runId;
    let fired = false;
    const finish = () => { if (fired || !alive(id)) return; fired = true; then?.(); };
    if (!speechOn) { finish(); return; }
    if (!speakSegments(segments, { onend: finish, onerror: finish })) { finish(); return; }
    // Some phones accept the speech and then never say it (or never say it's done) —
    // don't wait forever. Generous: about twice as long as it should take to read.
    const chars = segments.reduce((n, seg) => n + String(seg.text || "").length, 0);
    later(finish, chars * 120 + 4000);
  }

  function readQuestion() {
    if (done || destroyed) return;
    const id = ++runId;
    stopListening(); clearTimers();
    setPhase("reading"); say("");
    speak(questionToSegments(question, t, targetLang), () => { if (alive(id)) listen(); });
  }

  /* ---------------- listening ---------------- */
  function listen() {
    if (done || destroyed) return;
    if (!voiceOn) { setPhase("idle"); return; }
    const id = runId;
    setPhase("listening");
    let handled = false;
    listener = listenOnce(bcp(), {
      onresult: (alts) => { handled = true; if (alive(id)) heard(alts); },
      onerror: (code) => { handled = true; if (alive(id)) listenError(code); },
      onend: () => { if (!handled && alive(id)) heard([]); },
    });
    if (!listener) { voiceOn = false; setPhase("idle"); say(t("bus.micFailed")); paint(); return; }
    // A recogniser that neither answers nor ends would leave this open for good: call it silence.
    later(() => {
      if (handled || !alive(id)) return;
      handled = true;
      stopListening();
      heard([]);
    }, 12000);
  }

  function listenError(code) {
    if (code === "no-speech") { heard([]); return; }
    if (code === "aborted") return;                       // we stopped it ourselves
    voiceOn = false;                                      // not-allowed, network, audio-capture …
    setPhase("idle");
    say(code === "not-allowed" || code === "service-not-allowed" ? t("bus.micDenied")
      : code === "network" ? t("bus.micNetwork") : t("bus.micFailed"));
  }

  function heard(alternatives) {
    const r = parseSpokenChoice(alternatives, question.choices.map(toSpeakable));
    if (!r) {
      misses++;
      const id = ++runId;
      if (misses >= 3) {
        // Three misses: stop asking the microphone and hand it back to fingers.
        setPhase("idle"); say(t("bus.tapInstead"));
        speak([{ text: t("bus.tapInstead") }]);
        return;
      }
      setPhase("reading");
      speak([{ text: t("bus.didntCatch", { letters: listOf(letters) }) }], () => { if (alive(id)) listen(); });
      return;
    }
    if (r.type === "choice") answer(r.index, true);
    else if (r.type === "repeat") readQuestion();
    else if (r.type === "skip") doSkip();
    else pause();
  }

  /* ---------------- answering ---------------- */
  function answer(index, spoken = false) {
    if (done || destroyed || index < 0 || index >= question.choices.length) return;
    done = true; primed = true;
    const id = ++runId;
    stopListening(); stopSpeaking(); clearTimers();
    const correct = index === question.answer;
    paintOptions(index);
    setPhase("feedback");
    Object.assign(result, {
      correct, hintsUsed: correct ? 0 : 1, firstTry: correct, spoken,
      srsGrade: fromCorrect(correct, correct ? 0 : 1),
    });
    onDone(result);

    const inTarget = targetLang && choicesAreTarget(question.choices, question.prompt, targetLang.code);
    const rights = ["bus.right1", "bus.right2", "bus.right3"];
    const segments = correct
      ? [{ text: t(rights[(progress?.n || 0) % rights.length]) }]
      : [
          { text: t("bus.wrongPrefix", { letter: letters[question.answer] }) },
          { text: question.choices[question.answer], bcp: inTarget ? targetLang.bcp : null },
          ...(question.explanation ? [{ text: shortExplanation(question.explanation) }] : []),
        ];
    status.textContent = correct ? t("bus.rightNote") : t("bus.wrongNote", { letter: letters[question.answer] });
    speak(segments, () => later(() => { if (alive(id)) advance?.(); }, 900));
  }

  /* ---------------- controls ---------------- */
  function start() { primed = true; readQuestion(); }

  function pause() {
    ++runId;
    stopListening(); stopSpeaking(); clearTimers();
    setPhase("paused");
  }
  function resume() {
    primed = true;
    if (done) advance?.(); else readQuestion();
  }
  function onPause() { if (phase === "paused") resume(); else pause(); }

  function toggleVoice() {
    voiceOn = !voiceOn;
    setBusVoice(voiceOn);
    if (!voiceOn && phase === "listening") { ++runId; stopListening(); setPhase("idle"); return; }
    paint();
    if (voiceOn && phase === "idle" && !done) { misses = 0; listen(); }   // this tap is the gesture the microphone prompt needs
  }

  function onOrb() {
    if (phase === "start") start();
    else if (phase === "paused") resume();
    else if (phase === "listening") { ++runId; stopListening(); setPhase("idle"); }
    else if (phase === "reading") { ++runId; stopSpeaking(); listen(); }
    else if (phase === "idle" && !done) { misses = 0; if (!voiceOn && canListen) { voiceOn = true; setBusVoice(true); } listen(); }
  }

  function doSkip() {
    if (done) return;
    ++runId;
    stopListening(); stopSpeaking(); clearTimers();
    if (skip && skip()) return;                            // the session re-renders; our cleanup runs
    setPhase("idle");                                      // the last one left can't be put off
    say(t("bus.lastQuestion"));
  }

  // The screen locking or the tab going away ends recognition (and often speech)
  // on phones — stop cleanly and wait for the student instead of failing oddly.
  function onVisibility() {
    if (document.hidden && (phase === "reading" || phase === "listening" || phase === "feedback")) pause();
  }
  document.addEventListener("visibilitychange", onVisibility);

  function handleKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const k = e.key;
    const idx = /^[a-fA-F]$/.test(k) ? k.toUpperCase().charCodeAt(0) - 65 : /^[1-6]$/.test(k) ? Number(k) - 1 : -1;
    if (idx >= 0 && idx < question.choices.length && !done) { answer(idx); return true; }
    if ((k === "r" || k === "R") && !done) { readQuestion(); return true; }
    if (k === " " || k === "p" || k === "P") { if (phase === "start") start(); else onPause(); return true; }
    return false;
  }

  function cleanup() {
    destroyed = true;
    ++runId;
    stopListening(); stopSpeaking(); clearTimers();
    document.removeEventListener("visibilitychange", onVisibility);
  }

  paint();
  if (phase === "reading") later(readQuestion, 250);       // a breath after the screen changes
  return { el: node, result, handleKey, cleanup };
}

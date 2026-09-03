// Small synthesised sound effects.
//
// Tones are generated with the Web Audio API rather than shipped as files —
// it keeps the project asset-free and the whole thing is a few hundred bytes.
// Everything is gated on settings.sound and fails silently: audio is a nicety,
// never a reason for a broken screen.

import { store } from "../store.js";

let ctx = null;

function context() {
  if (ctx) return ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  try { ctx = new Ctor(); } catch { return null; }
  return ctx;
}

function enabled() {
  if (store.settings?.sound === false) return false;
  // Sound is decoration; if motion is unwelcome, so is noise.
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * One short note. `when` is an offset in seconds so callers can build a
 * little melody without scheduling timers.
 */
function note(freq, { when = 0, dur = 0.12, gain = 0.05, type = "sine" } = {}) {
  const ac = context();
  if (!ac) return;
  // Browsers suspend the context until a user gesture; a session always has one.
  if (ac.state === "suspended") ac.resume().catch(() => {});

  const t0 = ac.currentTime + when;
  const osc = ac.createOscillator();
  const amp = ac.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);

  // A quick fade in and out — a raw square edge clicks.
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  osc.connect(amp).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function safely(fn) {
  if (!enabled()) return;
  try { fn(); } catch { /* audio is never worth an error */ }
}

/** Rising major third — reads as "yes" without being a game-show buzzer. */
export function playCorrect() {
  safely(() => {
    note(587.33, { when: 0, dur: 0.1 });      // D5
    note(739.99, { when: 0.09, dur: 0.16 });  // F#5
  });
}

/** Soft low blip. Deliberately gentle — a wrong answer isn't a failure. */
export function playWrong() {
  safely(() => {
    note(311.13, { when: 0, dur: 0.14, gain: 0.04, type: "triangle" });  // D#4
  });
}

/** Three-note arpeggio for a strong result, alongside the confetti. */
export function playFanfare() {
  safely(() => {
    note(523.25, { when: 0, dur: 0.12 });     // C5
    note(659.25, { when: 0.1, dur: 0.12 });   // E5
    note(783.99, { when: 0.2, dur: 0.26 });   // G5
  });
}

/** Two gentle descending notes — "time's up, take a break". */
export function playChime() {
  safely(() => {
    note(659.25, { when: 0, dur: 0.3, gain: 0.045 });   // E5
    note(440.0, { when: 0.32, dur: 0.5, gain: 0.045 }); // A4
  });
}

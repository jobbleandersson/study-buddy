// Which voice features are switched on. The browser's built-in voices sound flat, so for now only the two
// that need nothing better stay on: reading text out loud, and the Listen mode for language sets
// (the foreign text hidden behind a play button). The rest is dormant, not removed: set a flag to true to
// bring a feature back (for example when a proper text-to-speech voice is added). Pure data, no imports.
export const VOICE_FEATURES = Object.freeze({
  readAloud: true,    // the speaker button, auto-read, and reading the tutor's replies aloud
  listening: true,    // Listen mode for language sets
  speaking: false,    // Speak mode for language sets (say the answer, scored by similarity)
  dictation: false,   // the microphone in the tutor chat
  commute: false,     // commute / bus mode (#/review?bus=1): questions read aloud, answered by voice
  talk: false,        // "Lyssna som samtal": the two-voice spoken conversation about a set
});

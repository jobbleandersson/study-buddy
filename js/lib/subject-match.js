// The subject an AI-written set belongs to, matched to one of the subjects the student can tick. The model names the
// subject in its own words ("Svenska", "Swedish", "Matematik 2", "Science"); the picker offers the student's own subjects
// and the usual school ones. A name that fits one of them is used, so a set about a Swedish essay comes back with
// "Svenska" ticked instead of whatever was ticked before the set was made. Anything that fits none is not used (null):
// the student's own choice stands rather than a new subject appearing from a guess.

// The usual school subjects by key (the keys of subj.std.* in the strings), with the words the model may use for each,
// in Swedish and English. A name matches when it starts with one of these words ("Svenska 2", "Matematik, år 8").
const WORDS = {
  math: ["matematik", "matte", "math", "maths", "mathematics"],
  swedish: ["svenska", "swedish"],
  english: ["engelska", "english"],
  biology: ["biologi", "biology"],
  chemistry: ["kemi", "chemistry"],
  physics: ["fysik", "physics"],
  history: ["historia", "history"],
  civics: ["samhällskunskap", "samhälle", "civics", "social studies"],
  geography: ["geografi", "geography"],
  religion: ["religionskunskap", "religion", "religious studies"],
};

const norm = (s) => String(s ?? "").trim().toLowerCase();

/** Which usual school subject (a key of WORDS) a name stands for, or null. */
export function standardKey(name) {
  const n = norm(name);
  if (!n) return null;
  for (const [key, words] of Object.entries(WORDS)) {
    if (words.some((w) => n === w || n.startsWith(w + " ") || n.startsWith(w + ",") || n.startsWith(w + "-") || n.startsWith(w + ":"))) return key;
  }
  return null;
}

/** The choice to tick for the subject `detected`, or null when none fits. `choices` are the names the picker offers;
 *  `standardNames` maps a key to the name the picker uses for that usual subject ({ swedish: "Svenska", ... }). */
export function matchSubject(detected, choices, standardNames) {
  const n = norm(detected);
  if (!n) return null;
  const exact = choices.find((c) => norm(c) === n);
  if (exact) return exact;
  const key = standardKey(detected);
  if (!key) return null;
  const wanted = norm(standardNames?.[key]);
  return (wanted && choices.find((c) => norm(c) === wanted)) || null;
}

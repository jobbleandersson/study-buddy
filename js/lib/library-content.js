// Loading + English overlay for the practice library's static content.
//
// Split out from js/data/library.js (which imports store.js) so that store.js
// can pull the loader in for syncLibraryLanguage() without an import cycle.
// The library's course content is Swedish-curriculum material; English mode
// lays two overlays on top rather than going through the app's per-string
// i18n, since it's bulk content, not UI chrome:
//   - data/library/index.en.json  — the browsing text (level labels, subject
//     names/descriptions, set titles/summaries); covers every id.
//   - data/library-en/<same filename>.json — the full question content,
//     one file per set, same ids as the Swedish original so attempts, SRS
//     records and per-topic mastery all carry straight over.
// Anything not translated yet just falls back to the Swedish original.

const INDEX_URL = "data/library/index.json";
const TRANSLATIONS_URL = "data/library/index.en.json";

let cachedIndex = null;
let cachedTranslations = null;

export async function loadLibraryIndex() {
  if (cachedIndex) return cachedIndex;
  const res = await fetch(INDEX_URL);
  if (!res.ok) throw new Error(String(res.status));
  cachedIndex = await res.json();
  return cachedIndex;
}

/** { levels: {[id]: label}, subjects: {[id]: {name, description}},
 *    sets: {[id]: {title, summary}} } — a missing id just means that piece
 *  isn't translated, so callers fall back to the Swedish original. Never
 *  throws: a 404 or parse error just means "nothing translated", not a
 *  broken library. */
export async function loadLibraryTranslations() {
  if (cachedTranslations) return cachedTranslations;
  try {
    const res = await fetch(TRANSLATIONS_URL);
    const data = res.ok ? await res.json() : null;
    cachedTranslations = { levels: {}, subjects: {}, sets: {}, ...(data || {}) };
  } catch {
    cachedTranslations = { levels: {}, subjects: {}, sets: {} };
  }
  return cachedTranslations;
}

/** "data/library/ak7-bio-djur.json" -> "data/library-en/ak7-bio-djur.json" */
export function englishFile(file) {
  return file.replace(/^data\/library\//, "data/library-en/");
}

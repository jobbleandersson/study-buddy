// Static content for the Högskoleprovet hub (#/hp) — deliberately its own
// small index, separate from the main practice library (data/library/index.json).
// HP isn't a curriculum subject a student browses among Swedish/Biology/etc.;
// it's a self-contained track with its own hub, so its picker lives here
// rather than inside #/library.

import { store } from "../store.js";

const INDEX_URL = "data/library/hp-index.json";
const TRANSLATIONS_URL = "data/library/hp-index.en.json";

let cachedIndex = null;
let cachedTranslations = null;

export async function loadHpIndex() {
  if (cachedIndex) return cachedIndex;
  const res = await fetch(INDEX_URL);
  if (!res.ok) throw new Error(String(res.status));
  cachedIndex = await res.json();
  return cachedIndex;
}

export async function loadHpTranslations() {
  if (cachedTranslations) return cachedTranslations;
  try {
    const res = await fetch(TRANSLATIONS_URL);
    const data = res.ok ? await res.json() : null;
    cachedTranslations = { subjects: {}, sets: {}, ...(data || {}) };
  } catch {
    cachedTranslations = { subjects: {}, sets: {} };
  }
  return cachedTranslations;
}

export function isHpImported(setId) {
  return !!store.getAssignment(setId);
}

/** Same contract as data/library.js's importSet: fetch the set (Swedish —
 *  there's no translated question content for HP yet) and add it to the
 *  student's own library. Returns the saved set, or null if already added. */
export async function importHpSet(entry) {
  if (isHpImported(entry.id)) return null;
  const res = await fetch(entry.file);
  if (!res.ok) throw new Error(String(res.status));
  const doc = await res.json();
  const a = store.addAssignmentDoc(doc, { silent: true });
  if (a) a._libLang = "sv";
  // The set files are Swedish; if the app is in English, translate the title
  // and subject now rather than waiting for the next boot or language switch.
  await store.syncHpLanguage();
  store.save();
  store.emit();
  return a;
}

/** Add every HP set that isn't in the library yet (a mock, a provpass or the prognosis draws on all
 *  of them). Best effort: a set that fails to load is skipped and the rest still come in. */
export async function ensureHpSets() {
  let index;
  try { index = await loadHpIndex(); } catch { return; }
  for (const s of index.sets) {
    if (isHpImported(s.id)) continue;
    try { await importHpSet(s); } catch { /* offline for that one: the run uses what did load */ }
  }
}

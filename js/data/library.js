// The practice library ("Övningsbibliotek"): ready-made, reviewed question
// sets for the Swedish curriculum (åk 7–gymnasiet), as static JSON under
// data/library/. No key, no backend — a new student has something to study
// straight away without first bringing their own material.
//
// Content loading + the English overlay live in lib/library-content.js (which
// doesn't import store.js), so store.js can reuse them for
// syncLibraryLanguage() without an import cycle.

import { store } from "../store.js";
import { getLang } from "../lib/i18n.js";
import { loadLibraryIndex, loadLibraryTranslations, englishFile } from "../lib/library-content.js";

export { loadLibraryIndex, loadLibraryTranslations };

/** Has this library set already been added to the student's own library?
 *  addAssignmentDoc() keeps the document id the first time, so an id lookup
 *  is enough. */
export function isImported(setId) {
  return !!store.getAssignment(setId);
}

/** Fetch the set and add it to the student's library. Returns the saved set,
 *  or null if it was already there. In English mode the translated file is
 *  tried first, falling back to the Swedish original if it isn't there yet;
 *  the set is tagged with the language it actually landed in so a later
 *  language switch can bring it up to date (see store.syncLibraryLanguage).
 *  `studyCount`, when given and smaller than the set, is remembered as this
 *  set's default number of questions per study session (chosen once, at
 *  add time — exam mode always ignores it and runs the full set). */
const inFlight = new Map();   // set id -> the import already running for it

export function importSet(entry, studyCount) {
  if (isImported(entry.id)) return Promise.resolve(null);
  // "Add all" and a card's own "Add" can both ask for the same set while its file is still loading.
  if (inFlight.has(entry.id)) return inFlight.get(entry.id).then(() => null);
  const p = importSetNow(entry, studyCount).finally(() => inFlight.delete(entry.id));
  inFlight.set(entry.id, p);
  return p;
}

async function importSetNow(entry, studyCount) {
  const lang = getLang();
  const wantFile = lang === "en" ? englishFile(entry.file) : entry.file;

  let res = await fetch(wantFile);
  let docLang = lang;
  if (!res.ok && wantFile !== entry.file) { res = await fetch(entry.file); docLang = "sv"; }
  if (!res.ok) throw new Error(String(res.status));

  const doc = await res.json();
  if (isImported(entry.id)) return null;   // added some other way while the file loaded
  const a = store.addAssignmentDoc(doc, { silent: true });
  if (a) {
    a._libLang = docLang;
    if (studyCount > 0 && studyCount < a.questions.length) a._studyCount = studyCount;
  }
  store.save();
  store.emit();
  return a;
}

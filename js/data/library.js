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
 *  language switch can bring it up to date (see store.syncLibraryLanguage). */
export async function importSet(entry) {
  if (isImported(entry.id)) return null;
  const lang = getLang();
  const wantFile = lang === "en" ? englishFile(entry.file) : entry.file;

  let res = await fetch(wantFile);
  let docLang = lang;
  if (!res.ok && wantFile !== entry.file) { res = await fetch(entry.file); docLang = "sv"; }
  if (!res.ok) throw new Error(String(res.status));

  const doc = await res.json();
  const a = store.addAssignmentDoc(doc, { silent: true });
  if (a) a._libLang = docLang;
  store.save();
  store.emit();
  return a;
}

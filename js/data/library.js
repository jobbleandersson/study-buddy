// The practice library ("Övningsbibliotek"): ready-made, reviewed question
// sets for the Swedish curriculum (åk 7–gymnasiet), as static JSON under
// data/library/. No key, no backend — a new student has something to study
// straight away without first bringing their own material.

import { store } from "../store.js";

const INDEX_URL = "data/library/index.json";

let cachedIndex = null;

export async function loadLibraryIndex() {
  if (cachedIndex) return cachedIndex;
  const res = await fetch(INDEX_URL);
  if (!res.ok) throw new Error(String(res.status));
  cachedIndex = await res.json();
  return cachedIndex;
}

/** Has this library set already been added to the student's own library?
 *  addAssignmentDoc() keeps the document id the first time, so an id lookup
 *  is enough. */
export function isImported(setId) {
  return !!store.getAssignment(setId);
}

/** Fetch the set and add it to the student's library. Returns the saved set,
 *  or null if it was already there. */
export async function importSet(entry) {
  if (isImported(entry.id)) return null;
  const res = await fetch(entry.file);
  if (!res.ok) throw new Error(String(res.status));
  const doc = await res.json();
  return store.addAssignmentDoc(doc);
}

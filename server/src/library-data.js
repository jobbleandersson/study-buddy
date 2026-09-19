// The ready-made library as the server sees it: which sets exist and which
// questions (and topics) each has. Class mode needs this to validate what a
// teacher assigns and to turn a student's synced answers into per-set results.
// The files are the same static JSON the frontend serves, read straight off disk.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// Same probing as the static file server in index.js: hosts lay the checkout
// out differently, so find the directory that really has the library.
function findLibraryDir() {
  const roots = [
    process.env.FRONTEND_ROOT,
    path.join(here, "..", ".."),
    path.join(process.cwd(), ".."),
    process.cwd(),
  ].filter(Boolean);
  for (const root of roots) {
    const dir = path.join(root, "data", "library");
    if (fs.existsSync(path.join(dir, "index.json"))) return dir;
  }
  return null;
}

const DIR = findLibraryDir();
let index = null;
const loaded = new Map();

/** { id, title, questions: [{ id, topic }] } for a library set id, or null
 *  if there's no such set. Only successes are cached, so junk ids can't grow
 *  the cache. */
export function librarySet(setId) {
  if (!DIR || !/^lib-[a-z0-9-]{1,60}$/.test(String(setId))) return null;
  if (loaded.has(setId)) return loaded.get(setId);
  try {
    index ??= JSON.parse(fs.readFileSync(path.join(DIR, "index.json"), "utf8"));
    const entry = index.sets.find((s) => s.id === setId);
    if (!entry) return null;
    // entry.file is "data/library/<name>.json"; only the file name is trusted.
    const doc = JSON.parse(fs.readFileSync(path.join(DIR, path.basename(entry.file)), "utf8"));
    const set = {
      id: setId,
      title: entry.title,
      questions: (doc.questions || []).map((q) => ({ id: q.id, topic: q.topic || "general" })),
    };
    loaded.set(setId, set);
    return set;
  } catch {
    return null;
  }
}

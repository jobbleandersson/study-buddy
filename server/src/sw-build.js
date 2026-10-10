// The service worker's version, taken from what it serves. sw.js serves the app's own files straight
// from a cache named after BUILD (see the top of sw.js), so BUILD must change whenever any of them
// does, and only then. It used to be a number bumped by hand in every PR; a forgotten bump would
// have left students on old code for good. Here it is a hash of sw.js and every file it lists,
// computed once at startup (a deployed image's files never change), and served in place of the
// "dev" placeholder. Every static response also carries it as X-Build, so the worker can tell a
// file from a machine still on the previous build during a rolling deploy.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const PLACEHOLDER = 'const BUILD = "dev";';

/** The "./…" paths sw.js names (APP_SHELL, LANG_FILES and the rest), as files under `root`. */
export function listedFiles(swSource) {
  const paths = new Set();
  for (const m of swSource.matchAll(/"\.\/([^"]*)"/g)) paths.add(m[1] === "" ? "index.html" : m[1]);
  return [...paths].sort();
}

/** 12 hex characters that change when sw.js or any file it lists changes. */
export function computeBuild(root, swSource) {
  const hash = crypto.createHash("sha256").update(swSource);
  for (const rel of listedFiles(swSource)) {
    hash.update(`\0${rel}\0`);
    try { hash.update(fs.readFileSync(path.join(root, rel))); } catch { hash.update("missing"); }
  }
  return hash.digest("hex").slice(0, 12);
}

/** sw.js with its build filled in, or null when the placeholder isn't there (then it's served as is). */
export function stampedSw(swSource, build) {
  return swSource.includes(PLACEHOLDER) ? swSource.replace(PLACEHOLDER, `const BUILD = "${build}";`) : null;
}

/** { build, body } for the frontend at `root`; null without a stampable sw.js. */
export function serviceWorker(root) {
  let source;
  try { source = fs.readFileSync(path.join(root, "sw.js"), "utf8"); } catch { return null; }
  const build = computeBuild(root, source);
  const body = stampedSw(source, build);
  return body ? { build, body } : null;
}

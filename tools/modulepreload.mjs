// Writes index.html's list of the app's startup modules (<link rel="modulepreload">, between the
// modulepreload markers): every module js/main.js imports, directly or through another module, before it can
// run. Without the list the browser finds them a level at a time — fetch main.js, read it, fetch what it
// imports, read those, and so on, seven levels deep — one round trip per level, which on a phone's mobile data
// was most of a first visit's wait. With it, all of them are requested together as the page starts.
//
// The first screen's own modules (three more levels) are listed too, for the two screens a bare pluggera.se
// opens: the front page and Hem. They go in <meta> tags, not links, because only js/boot.js knows which of the
// two this visit gets (saved data on the device or not); it requests that one's.
//
//   node tools/modulepreload.mjs           rewrite the lists in index.html
//   node tools/modulepreload.mjs --check   exit 1 if they're out of date (test/lib/modulepreload.test.mjs does this)
//
// Only static imports count: a dynamic import() is a screen or feature loaded later, on purpose.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const INDEX = join(ROOT, "index.html");
const START = "<!-- modulepreload:start";
const END = "<!-- modulepreload:end -->";
// The root address's two screens: the front page for a new visitor, Hem for everyone else (main.js, routes).
export const SCREENS = { landing: "js/views/landing.js", home: "js/views/menu.js" };
// `import x from "./y.js"`, `import "./y.js"`, `export { x } from "./y.js"`, `export * from "./y.js"` — at the
// start of a line, as every module here writes them; import("…") (no space before the parenthesis) is left out.
const STATIC_IMPORT = /^\s*(?:import\s+(?:[^"';]+?\s+from\s+)?|export\s+(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+)["'](\.[^"']+)["']/gm;

const toPath = (file) => relative(ROOT, file).split("\\").join("/");

/** Every module `entry` imports, directly or through another, as absolute file paths. */
function closure(entry) {
  const seen = new Set();
  const visit = (file) => {
    for (const m of readFileSync(file, "utf8").matchAll(STATIC_IMPORT)) {
      const dep = resolve(dirname(file), m[1]);
      if (seen.has(dep)) continue;
      seen.add(dep);
      visit(dep);
    }
  };
  visit(join(ROOT, entry));
  return seen;
}

/** Paths (from the site root) of every module main.js needs before it runs, in a stable order. */
export function startupModules() {
  return [...closure("js/main.js")].map(toPath).sort();
}

/** A screen's module and the ones it imports that aren't startup modules already, in a stable order. */
export function screenModules(view) {
  const startup = new Set(startupModules());
  startup.add("js/main.js");
  return [view, ...[...closure(view)].map(toPath).filter((p) => !startup.has(p) && p !== view).sort()];
}

/** The block as it belongs in index.html. */
export function preloadBlock() {
  return [
    `${START} (written by tools/modulepreload.mjs: run it after changing an import) -->`,
    ...startupModules().map((p) => `  <link rel="modulepreload" href="${p}" />`),
    ...Object.entries(SCREENS).map(([name, view]) => `  <meta name="preload-screen-${name}" content="${screenModules(view).join(" ")}" />`),
    `  ${END}`,
  ].join("\n");
}

/** index.html's current block, or null if the markers are missing. */
export function currentBlock(html = readFileSync(INDEX, "utf8")) {
  const a = html.indexOf(START);
  const b = html.indexOf(END);
  return a < 0 || b < a ? null : html.slice(a, b + END.length);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const html = readFileSync(INDEX, "utf8");
  const now = currentBlock(html);
  if (!now) { console.error("index.html has no modulepreload markers"); process.exit(1); }
  const want = preloadBlock();
  if (process.argv.includes("--check")) {
    if (now !== want) { console.error("index.html's modulepreload lists are out of date: run node tools/modulepreload.mjs"); process.exit(1); }
  } else {
    writeFileSync(INDEX, html.replace(now, want));
    console.log(`index.html: ${startupModules().length} startup modules; ` + Object.entries(SCREENS).map(([n, v]) => `${n} ${screenModules(v).length}`).join(", "));
  }
}

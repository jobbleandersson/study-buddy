// Resolve a question figure's path to a URL that works wherever the app is
// served from — a domain root (serve.ps1, the Node server) or a subpath
// (GitHub Pages' /study-buddy/). Same reasoning as js/config.js: a root-
// absolute "/data/..." misses the Pages subpath entirely.
//
// Figures live at data/library/figures/... and are referenced from question
// JSON as a repo-root-relative path with no leading slash, e.g.
//   "figure": { "src": "hp/2026v/dtk-03.svg", "alt": "…" }
// which resolves under data/library/figures/.

const BASE = new URL("../../data/library/figures/", import.meta.url);

/** "hp/2026v/dtk-03.svg" -> absolute URL under data/library/figures/. */
export function figureURL(src) {
  return new URL(String(src || "").replace(/^\.?\/*/, ""), BASE).href;
}

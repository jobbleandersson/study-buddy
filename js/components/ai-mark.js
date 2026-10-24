// The AI's own mark: a flat brand-blue tile with one solid four-point star (css: .ai-tile), so every place
// the AI is the one acting wears the same thing — the sidebar item, the tutor, the help chat, a set the
// AI wrote. Plain flat icons stay for everything else.

import { el } from "../lib/dom.js";

/** The star, filled: the outlined app icon (ICONS.spark) with its small extra cross read as noise at
 *  avatar sizes. */
export const AI_GLYPH = "M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.13 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.13a.5.5 0 0 1-.96 0Z";

/** The star on its own, as markup (mascot.js builds its tile from a string). */
export const aiGlyphSvg = () => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${AI_GLYPH}"/></svg>`;

/** The tile, `size` px square. Decorative: whatever it sits beside names it. */
export function aiTile(size = 24) {
  const tile = el("span.ai-tile", { style: { "--s": `${size}px` }, "aria-hidden": "true" });
  tile.innerHTML = aiGlyphSvg();
  return tile;
}

/** Was this set written by the AI? Sets made through the AI carry `ai: true`; the högskoleprov
 *  "AI-skapade frågor" sets (lib-hp-<delprov>-ai) predate the flag and are recognised by their id. */
export function isAiSet(a) {
  return !!a && (a.ai === true || /^lib-hp-.+-ai$/.test(String(a.id || "")));
}

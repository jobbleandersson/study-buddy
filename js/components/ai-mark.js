// The AI's own mark: a deep-blue tile with a soft sheen and the app's outlined AI sparkles (css: .ai-tile), so
// every place the AI is the one acting wears the same thing — the sidebar item, the tutor, the help chat, a
// set the AI wrote. Plain flat icons stay for everything else.

import { el, ICONS } from "../lib/dom.js";

/** The sparkles as markup (mascot.js builds its tile from a string). */
export const aiGlyphSvg = () =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS.spark}"/></svg>`;

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

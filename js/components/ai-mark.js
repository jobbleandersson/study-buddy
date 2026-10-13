// The AI's own mark: the blue-to-violet tile from the PluggEra AI page (css: .ai-tile), so every place
// the AI is the one acting wears the same thing — the sidebar item, the tutor, the help chat, a set the
// AI wrote. Plain flat icons stay for everything else.

import { el, icon, ICONS } from "../lib/dom.js";

/** The sparkle tile, `size` px square. Decorative: whatever it sits beside names it. */
export function aiTile(size = 24) {
  return el("span.ai-tile", { style: { "--s": `${size}px` }, "aria-hidden": "true" }, [icon(ICONS.spark, size)]);
}

/** Was this set written by the AI? Sets made through the AI carry `ai: true`; the högskoleprov
 *  "AI-skapade frågor" sets (lib-hp-<delprov>-ai) predate the flag and are recognised by their id. */
export function isAiSet(a) {
  return !!a && (a.ai === true || /^lib-hp-.+-ai$/.test(String(a.id || "")));
}

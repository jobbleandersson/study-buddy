// A small progress ring for the daily goal: shows the count answered so far,
// filling as it approaches the goal. Shared by the home strip and Progress.

import { el } from "../lib/dom.js";

export function goalRing(done, goal) {
  const hit = goal > 0 && done >= goal;
  const pct = goal > 0 ? Math.min(100, Math.round((done / goal) * 100)) : 0;
  const wrap = el("span.ring.ring--goal" + (hit ? ".ring--goal-done" : ""), {
    style: { "--v": pct },
    "aria-label": `${done} / ${goal}`,
  });
  // Past the goal the raw count just climbs ("23" in a full circle reads as a
  // bug) — swap it for a check once the ring is full. The count moves to the
  // label beside the ring at both call sites.
  const centre = hit
    ? `<path class="ring__check" d="M12.5 18.5l3.5 3.5 7.5-8" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<text class="ring__label" x="18" y="18" text-anchor="middle" dominant-baseline="central">${done}</text>`;
  wrap.innerHTML =
    `<svg viewBox="0 0 36 36" aria-hidden="true">` +
    `<circle class="ring__bg" cx="18" cy="18" r="15.9"/>` +
    `<circle class="ring__fg" cx="18" cy="18" r="15.9" pathLength="100" transform="rotate(-90 18 18)"/>` +
    centre +
    `</svg>`;
  return wrap;
}

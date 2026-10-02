// A small, restrained avatar mark for the tutor — a brand glyph, not a
// cartoon face. Mood still comes through, just as a subtle status dot
// (like an online/typing indicator) rather than an expression change.
// mascot(mood, size) -> HTMLElement ;  setMood(el, mood)
//
// The glyph is the app's AI sparkles (ICONS.spark), so the tutor wears the
// same mark as "PluggEra AI" in the menu and on the home page.

import { ICONS } from "../lib/dom.js";

const DOT = {
  thinking:  { color: "var(--ink-faint)", pulse: true },
  cheer:     { color: "var(--ok)", pulse: false },
  encourage: { color: "var(--brand)", pulse: false },
};

export function mascot(mood = "idle", size = 40) {
  const wrap = document.createElement("span");
  wrap.className = "mascot";
  wrap.style.width = wrap.style.height = `${size}px`;
  wrap.innerHTML = `
    <svg width="${size}" height="${size}" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="PluggEra">
      <rect x="1" y="1" width="38" height="38" rx="10" fill="var(--brand-tint)" stroke="var(--line)"/>
      <g transform="translate(9 9) scale(0.9167)" fill="none" stroke="var(--brand)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="${ICONS.spark}"/>
      </g>
    </svg>
    <i class="mascot__dot"></i>`;
  setMood(wrap, mood);
  return wrap;
}

export function setMood(el, mood) {
  const dot = el.querySelector(".mascot__dot");
  if (!dot) return;
  const cfg = DOT[mood];
  dot.hidden = !cfg;
  if (!cfg) return;
  dot.style.background = cfg.color;
  dot.classList.toggle("mascot__dot--pulse", !!cfg.pulse);
}

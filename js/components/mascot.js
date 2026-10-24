// The AI's avatar — the tutor in a set, the PluggEra AI page header, the help chat: the AI's tile
// (ai-mark.js, css: .ai-tile), not a cartoon face. Mood still comes through, just as a
// subtle status dot (like an online/typing indicator) rather than an expression change, and while the
// AI is thinking the tile slowly pulses (and a halo behind it, where the container has one, speeds up).
// mascot(mood, size) -> HTMLElement ;  setMood(el, mood)
//
// The glyph is the app's AI sparkles (ai-mark.js), so the tutor wears the same mark as "PluggEra AI" in
// the menu and on the home page.

import { aiGlyphSvg } from "./ai-mark.js";

const DOT = {
  thinking:  { color: "var(--ink-faint)", pulse: true },
  cheer:     { color: "var(--ok)", pulse: false },
  encourage: { color: "var(--brand)", pulse: false },
};

export function mascot(mood = "idle", size = 40) {
  const wrap = document.createElement("span");
  wrap.className = "mascot";
  wrap.style.width = wrap.style.height = `${size}px`;
  wrap.setAttribute("role", "img");
  wrap.setAttribute("aria-label", "PluggEra");
  wrap.innerHTML = `
    <span class="ai-tile" style="--s:${size}px" aria-hidden="true">${aiGlyphSvg()}</span>
    <i class="mascot__dot"></i>`;
  setMood(wrap, mood);
  return wrap;
}

export function setMood(el, mood) {
  el.classList.toggle("is-thinking", mood === "thinking");
  const dot = el.querySelector(".mascot__dot");
  if (!dot) return;
  const cfg = DOT[mood];
  dot.hidden = !cfg;
  if (!cfg) return;
  dot.style.background = cfg.color;
  dot.classList.toggle("mascot__dot--pulse", !!cfg.pulse);
}

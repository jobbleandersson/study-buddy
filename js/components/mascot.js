// A small, restrained avatar mark for the tutor — a brand glyph, not a
// cartoon face. Mood still comes through, just as a subtle status dot
// (like an online/typing indicator) rather than an expression change.
// mascot(mood, size) -> HTMLElement ;  setMood(el, mood)

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
    <svg width="${size}" height="${size}" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="StudyBuddy">
      <rect x="1" y="1" width="38" height="38" rx="10" fill="var(--brand-tint)" stroke="var(--line)"/>
      <path d="M20 11l2.1 5.9L28 19l-5.9 2.1L20 27l-2.1-5.9L12 19l5.9-2.1L20 11Z" fill="var(--brand)"/>
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

// One tiny SVG character — a friendly book — with a few swappable expressions.
// mascot(mood, size) -> SVGElement ;  setMood(el, mood)

const FACES = {
  idle:      `<circle cx="20" cy="21" r="2.1" fill="#2B2B3A"/><circle cx="30" cy="21" r="2.1" fill="#2B2B3A"/><path d="M20 27c2 2 8 2 10 0" stroke="#2B2B3A" stroke-width="2" fill="none" stroke-linecap="round"/>`,
  thinking:  `<circle cx="20" cy="21" r="2.1" fill="#2B2B3A"/><circle cx="30" cy="21" r="2.1" fill="#2B2B3A"/><path d="M19 28h7" stroke="#2B2B3A" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="35" cy="14" r="1.6" fill="#8A8A9C"/><circle cx="39" cy="10" r="1.1" fill="#8A8A9C"/>`,
  cheer:     `<path d="M17 21c1-2 4-2 5 0" stroke="#2B2B3A" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M28 21c1-2 4-2 5 0" stroke="#2B2B3A" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M19 26c2 4 10 4 12 0" stroke="#2B2B3A" stroke-width="2.4" fill="none" stroke-linecap="round"/>`,
  encourage: `<circle cx="20" cy="21" r="2.1" fill="#2B2B3A"/><circle cx="30" cy="21" r="2.1" fill="#2B2B3A"/><path d="M20 26c2 1.5 8 1.5 10 0" stroke="#2B2B3A" stroke-width="2" fill="none" stroke-linecap="round"/>`,
};

export function mascot(mood = "idle", size = 44) {
  const wrap = document.createElement("span");
  wrap.style.display = "inline-flex";
  wrap.innerHTML = `
    <svg width="${size}" height="${size}" viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="StudyBuddy mascot">
      <rect x="6" y="8" width="38" height="34" rx="7" fill="#FFE08A"/>
      <path d="M25 8v34" stroke="#F0913C" stroke-width="2"/>
      <rect x="6" y="8" width="38" height="34" rx="7" fill="none" stroke="#F0913C" stroke-width="2"/>
      <g class="mascot-face">${FACES[mood] || FACES.idle}</g>
    </svg>`;
  return wrap;
}

export function setMood(el, mood) {
  const face = el.querySelector(".mascot-face");
  if (face) face.innerHTML = FACES[mood] || FACES.idle;
}

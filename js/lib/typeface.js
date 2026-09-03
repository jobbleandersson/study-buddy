// Typeface + text-size, applied as data-font / data-textsize on <html>.
// Mirrors js/lib/theme.js — read from localStorage at startup (index.html
// bootstrap) so the page never flashes the wrong type.

const FONT_KEY = "studybuddy.font";
const SIZE_KEY = "studybuddy.textSize";

export const FONTS = [
  ["system", "Default"],
  ["hyperlegible", "Hyperlegible (easier to read)"],
];
export const TEXT_SIZES = [
  ["s", "Small"],
  ["m", "Medium"],
  ["l", "Large"],
];

export function getFont() {
  const f = localStorage.getItem(FONT_KEY);
  return f === "hyperlegible" ? f : "system";
}
export function getTextSize() {
  const s = localStorage.getItem(SIZE_KEY);
  return ["s", "m", "l"].includes(s) ? s : "m";
}

export function applyTypeface(font = getFont(), size = getTextSize()) {
  const root = document.documentElement;
  root.setAttribute("data-font", font);
  root.setAttribute("data-textsize", size);
}

export function setFont(font) {
  localStorage.setItem(FONT_KEY, font);
  applyTypeface();
}
export function setTextSize(size) {
  localStorage.setItem(SIZE_KEY, size);
  applyTypeface();
}

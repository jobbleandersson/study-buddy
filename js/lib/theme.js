// Light / dark / system theme, applied as data-theme on <html>.
// Read straight from localStorage at startup so the page never flashes the
// wrong palette before the store has finished loading.

const KEY = "studybuddy.theme";
export const THEMES = [
  ["system", "Match my device"],
  ["light", "Light"],
  ["paper", "Warm paper"],
  ["dark", "Dark"],
];
const VALID = ["light", "paper", "dark", "system"];

export function getTheme() {
  const t = localStorage.getItem(KEY);
  return VALID.includes(t) ? t : "system";
}

export function applyTheme(theme = getTheme()) {
  document.documentElement.setAttribute("data-theme", theme);
}

export function setTheme(theme) {
  localStorage.setItem(KEY, theme);
  applyTheme(theme);
  window.dispatchEvent(new CustomEvent("sb:themechange", { detail: { theme } }));
}

/** True if what's on screen right now is the dark palette. */
export function isDark() {
  const t = getTheme();
  if (t === "dark") return true;
  if (t === "light" || t === "paper") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

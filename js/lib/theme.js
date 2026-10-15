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
  syncThemeColor(theme);
}

/** The browser's own bars (address bar, phone status bar) follow theme-color, set to the page's own
 *  ground (--canvas) so they run into the page without a seam. index.html's two tags are per device
 *  light/dark; a theme picked in the app wins over that, and "system" puts them back. The first run of
 *  this is in boot.js, before first paint. */
function syncThemeColor(theme) {
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    const darkTag = /dark/.test(meta.getAttribute("media") || "");
    meta.setAttribute("content", theme === "dark" || (theme === "system" && darkTag) ? "#0A0C11"
      : theme === "paper" ? "#F1E7D0" : "#F6F7F9");
  }
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

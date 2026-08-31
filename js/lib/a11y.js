// Accessibility helpers.
//
// v1 put aria-live="polite" on the whole #app, so every route change made a
// screen reader read the entire page. Announcements now go through one small
// off-screen region, and focus is moved deliberately after each navigation.

let region;

function ensureRegion() {
  if (!region || !region.isConnected) {
    region = document.createElement("div");
    region.className = "sr-only";
    region.setAttribute("aria-live", "polite");
    region.setAttribute("aria-atomic", "true");
    document.body.appendChild(region);
  }
  return region;
}

/** Say one short sentence to assistive tech. Visible UI is unaffected. */
export function announce(message) {
  if (!message) return;
  const r = ensureRegion();
  r.textContent = "";
  // A repeat of identical text is otherwise swallowed; the clear + delay forces it.
  setTimeout(() => { r.textContent = message; }, 40);
}

/**
 * Move focus to a view's main heading so keyboard and screen-reader users
 * start at the new content rather than back at the top of the document.
 */
export function focusHeading(container) {
  if (!container) return;
  const h = container.matches?.("h1, h2") ? container : container.querySelector("h1, h2");
  const target = h || container;
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  try { target.focus({ preventScroll: true }); } catch { target.focus(); }
}

export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

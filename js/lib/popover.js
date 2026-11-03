// Small anchored dropdown for the topbar/sidebar bell + profile buttons —
// positioned under `anchor`, closed by an outside click, Escape, or the next
// open call. Mirrors the card ⋮ menu's positioning approach in views/menu.js,
// but kept separate (own class, own close fn) since that one lives in a single
// view while this one lives in the persistent shell and must survive route
// changes without the two systems' cleanup calls stepping on each other.

import { el } from "./dom.js";
import { FOCUSABLE, menuStep, tabLeaves } from "./modal-a11y.js";

// The button that opened the popover now open: its aria-expanded follows the popover.
let anchorEl = null;

function escClose(e) { if (e.key === "Escape") closePopover(); }

// A click INSIDE the popover must not close it — otherwise a popover with its
// own interactive content (the notification panel's tabs and mark-read
// buttons repaint in place) would destroy itself the instant anything inside
// it was clicked, since the click still bubbles to this document listener.
function outsideClick(e) {
  const open = document.querySelector(".popover");
  if (open && !open.contains(e.target)) closePopover();
}

export function closePopover() {
  document.querySelectorAll(".popover").forEach((m) => m.remove());
  if (anchorEl?.hasAttribute("aria-haspopup")) anchorEl.setAttribute("aria-expanded", "false");
  anchorEl = null;
  document.removeEventListener("click", outsideClick);
  document.removeEventListener("keydown", escClose);
  window.removeEventListener("hashchange", closePopover);
}

/** Keyboard for a menu or small panel that sits at the end of <body>, where the page's Tab order would never
 *  reach it: Escape closes it and goes back to its button; Tab out of it closes it and carries on from its
 *  button, as a native menu does; arrow keys, Home and End step through a menu's items. The caller still
 *  closes it on an Escape pressed elsewhere. `close` must not move focus. */
export function menuKeys(menu, anchor, close, role = menu.getAttribute("role")) {
  menu.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { close(); anchor.focus(); return; }
    const items = [...menu.querySelectorAll(FOCUSABLE)].filter((x) => x.getClientRects().length);
    const at = items.indexOf(document.activeElement);
    if (e.key === "Tab") {
      if (!tabLeaves(role, at, items.length, e.shiftKey)) return;
      close();
      anchor.focus();
      if (e.shiftKey) e.preventDefault();   // Shift+Tab stops on the button; Tab carries on past it
      return;
    }
    if (role !== "menu") return;
    const next = menuStep(e.key, at, items.length);
    if (next === null) return;
    e.preventDefault();
    items[next].focus();
  });
}

/** `placement`: "below" (default), "above", or "right" (beside the anchor, top
 *  edges aligned). `fixed` pins the popover to the viewport instead of the page,
 *  for anchors that don't scroll with it (the sticky sidebar) — otherwise the
 *  menu would drift away from its button when the page scrolls. Focus moves to
 *  its first control; a caller that wants another one focuses it afterwards. */
export function openPopover(anchor, children, { align = "left", width = 260, role = "menu", label, placement = "below", fixed = false, offset = 6 } = {}) {
  closePopover();
  const menu = el("div.popover", { role, "aria-label": label }, children);
  const r = anchor.getBoundingClientRect();
  const sx = fixed ? 0 : window.scrollX;
  const sy = fixed ? 0 : window.scrollY;
  if (fixed) menu.style.position = "fixed";
  const left = placement === "right" ? r.right + offset : align === "right" ? r.right - width : r.left;
  menu.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8)) + sx}px`;
  menu.style.width = `${width}px`;
  document.body.appendChild(menu);
  // Placed after it's in the page: "above" and "right" need the rendered height,
  // both to position it and to keep it inside the window.
  const h = menu.offsetHeight;
  let top = placement === "above" ? r.top - offset - h : placement === "right" ? r.top : r.bottom + offset;
  if (placement !== "below") top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
  menu.style.top = `${top + sy}px`;

  anchorEl = anchor;
  if (anchor.hasAttribute("aria-haspopup")) anchor.setAttribute("aria-expanded", "true");
  menuKeys(menu, anchor, closePopover, role);
  menu.querySelector(FOCUSABLE)?.focus();

  setTimeout(() => {
    document.addEventListener("click", outsideClick);
    document.addEventListener("keydown", escClose);
    // Back/forward (or any non-click route change) would otherwise leave the
    // menu open over the next page.
    window.addEventListener("hashchange", closePopover);
  }, 0);
  return menu;
}

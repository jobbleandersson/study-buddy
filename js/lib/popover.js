// Small anchored dropdown for the topbar/sidebar bell + profile buttons —
// positioned under `anchor`, closed by an outside click, Escape, or the next
// open call. Mirrors the card ⋮ menu's positioning approach in views/menu.js,
// but kept separate (own class, own close fn) since that one lives in a single
// view while this one lives in the persistent shell and must survive route
// changes without the two systems' cleanup calls stepping on each other.

import { el } from "./dom.js";

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
  document.removeEventListener("click", outsideClick);
  document.removeEventListener("keydown", escClose);
  window.removeEventListener("hashchange", closePopover);
}

/** `placement`: "below" (default), "above", or "right" (beside the anchor, top
 *  edges aligned). `fixed` pins the popover to the viewport instead of the page,
 *  for anchors that don't scroll with it (the sticky sidebar) — otherwise the
 *  menu would drift away from its button when the page scrolls. */
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

  setTimeout(() => {
    document.addEventListener("click", outsideClick);
    document.addEventListener("keydown", escClose);
    // Back/forward (or any non-click route change) would otherwise leave the
    // menu open over the next page.
    window.addEventListener("hashchange", closePopover);
  }, 0);
  return menu;
}

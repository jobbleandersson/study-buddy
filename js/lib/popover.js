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
}

export function openPopover(anchor, children, { align = "left", width = 260, role = "menu", label } = {}) {
  closePopover();
  const menu = el("div.popover", { role, "aria-label": label }, children);
  const r = anchor.getBoundingClientRect();
  const left = align === "right" ? r.right + window.scrollX - width : r.left + window.scrollX;
  menu.style.top = `${r.bottom + window.scrollY + 6}px`;
  menu.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`;
  menu.style.width = `${width}px`;
  document.body.appendChild(menu);

  setTimeout(() => {
    document.addEventListener("click", outsideClick);
    document.addEventListener("keydown", escClose);
  }, 0);
  return menu;
}

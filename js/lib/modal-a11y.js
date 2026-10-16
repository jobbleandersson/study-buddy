// One place that gives every modal dialog the same keyboard and screen-reader behaviour, so each of the
// twenty-odd dialogs doesn't have to (and most didn't): any element appended to <body> with
// aria-modal="true" gets
//   - focus moved into it (unless the dialog already focused something of its own),
//   - Tab / Shift+Tab kept inside it,
//   - everything else on the page made inert and aria-hidden (toasts stay live),
//   - focus returned to the control that opened it once it is removed.
// Escape stays with each dialog: what "cancel" means differs (a confirm resolves false, a form may be
// busy), and none of them can be left without it. Mounted once from main.js. A non-modal panel (the site
// chat) uses aria-modal="false" and is left alone.

// Tab stops: tabindex="-1" opts an element out, even a button (the palette's rows are reached by arrow keys).
const FOCUSABLE = ['a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])',
  'textarea:not([disabled])', 'summary', '[contenteditable="true"]', '[tabindex]']
  .map((sel) => sel + ':not([tabindex="-1"])').join(", ");

/** Where Tab / Shift+Tab should send focus, or null to let the browser move it (pure, for tests).
 *  `items` are the dialog's focusable elements in order; `active` is the focused element (or the dialog
 *  itself, or something outside it). */
export function cycleTarget(items, active, shift) {
  if (!items.length) return null;
  const first = items[0], last = items[items.length - 1];
  const at = items.indexOf(active);
  if (at === -1) return shift ? last : first;          // focus is outside the dialog or on its frame
  if (shift && active === first) return last;
  if (!shift && active === last) return first;
  return null;
}

const isVisible = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
const focusablesIn = (root) => [...root.querySelectorAll(FOCUSABLE)].filter(isVisible);

// The control that last had the user's attention outside any dialog. A dialog usually focuses its own
// button synchronously, before the observer below runs, so document.activeElement can no longer tell us
// who opened it; and Safari doesn't focus a button on click at all, so a click counts too.
const stack = [];                 // open modals, innermost last: { node, opener, hidden }
let lastActivator = null;
// A control inside a dialog that is already open counts (it can open a second one, and focus returns
// there); one inside a dialog that has only just been added doesn't (that is it focusing its own button).
const remember = (e) => {
  const t = e.target && e.target.closest ? e.target.closest(FOCUSABLE) : null;
  // A click on something that can't take focus (a div with a click handler) must not leave an older,
  // unrelated control as the place focus returns to: better to return nowhere.
  if (!t) { if (e.type === "pointerdown") lastActivator = null; return; }
  const modal = t.closest('[aria-modal="true"]');
  if (!modal || stack.some((s) => s.node === modal)) lastActivator = t;
};

const hiddenCount = new Map();    // page element -> how many open modals are hiding it

function hide(elm) {
  const n = (hiddenCount.get(elm) || 0) + 1;
  hiddenCount.set(elm, n);
  if (n === 1) {
    elm.__modalWas = { inert: elm.inert, ariaHidden: elm.getAttribute("aria-hidden") };
    elm.inert = true;
    elm.setAttribute("aria-hidden", "true");   // Safari before 15.5 has no `inert`
  }
}
function unhide(elm) {
  const n = (hiddenCount.get(elm) || 0) - 1;
  if (n > 0) { hiddenCount.set(elm, n); return; }
  hiddenCount.delete(elm);
  const was = elm.__modalWas || {};
  elm.inert = !!was.inert;
  if (was.ariaHidden == null) elm.removeAttribute("aria-hidden"); else elm.setAttribute("aria-hidden", was.ariaHidden);
  delete elm.__modalWas;
}

function opened(node) {
  if (stack.some((s) => s.node === node)) return;
  const opener = lastActivator && lastActivator.isConnected ? lastActivator : null;
  const hidden = [];
  // Focus goes in first: hiding a subtree that still holds focus makes browsers refuse aria-hidden (and log it).
  if (!node.contains(document.activeElement)) {
    const first = focusablesIn(node)[0];
    if (first) first.focus();
    else { node.tabIndex = -1; node.focus(); }
  }
  for (const child of document.body.children) {
    if (child === node || child.contains(node) || child.matches("script, style, link, .toast")) continue;
    hide(child);
    hidden.push(child);
  }
  stack.push({ node, opener, hidden });
}

function closed(entry) {
  stack.splice(stack.indexOf(entry), 1);
  entry.hidden.forEach(unhide);
  const { opener } = entry;
  // Back to the control that opened it — unless the page moved on and it is gone, or the dialog's own
  // close code already put focus somewhere useful.
  if (opener && opener.isConnected && (document.activeElement === document.body || !document.activeElement)) {
    opener.focus({ preventScroll: true });
  }
}

let mounted = false;
export function mountModalA11y() {
  if (mounted || typeof MutationObserver === "undefined") return;
  mounted = true;
  new MutationObserver((records) => {
    for (const r of records) {
      r.addedNodes.forEach((n) => {
        if (n.nodeType === 1 && n.getAttribute("aria-modal") === "true") opened(n);
      });
      r.removedNodes.forEach((n) => {
        const entry = stack.find((s) => s.node === n);
        if (entry) closed(entry);
      });
    }
  }).observe(document.body, { childList: true });

  document.addEventListener("focusin", remember, true);
  document.addEventListener("pointerdown", remember, true);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || !stack.length) return;
    const { node } = stack[stack.length - 1];
    const items = focusablesIn(node);
    const target = cycleTarget(items, document.activeElement, e.shiftKey);
    if (target) { e.preventDefault(); target.focus(); }
    else if (!items.length) { e.preventDefault(); node.focus(); }
  }, true);
}

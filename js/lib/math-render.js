// Formulas, typeset by KaTeX (vendor/katex.min.js + .css, ~75 kB over the wire). It is loaded when the first
// formula is drawn, not before the app can start: most screens never show one, and on a phone's mobile data
// it held up every first visit. Until it's in, a formula is drawn as its source in a placeholder, and every
// placeholder on the page is typeset the moment KaTeX arrives. main.js also fetches it in the background once
// the first screen is up (and at once on screens made of questions), so it is usually here before it's needed.

let loading = null;
let styled = false;

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ready = () => typeof window !== "undefined" && typeof window.katex !== "undefined";

/** Fetch KaTeX (script and stylesheet) once. Resolves when it can typeset; never rejects. */
export function loadMath() {
  if (ready() || typeof document === "undefined") return Promise.resolve();
  if (loading) return loading;
  if (!styled) {
    styled = true;
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "vendor/katex.min.css";
    document.head.appendChild(css);
  }
  loading = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "vendor/katex.min.js";
    script.async = true;
    script.onload = resolve;
    // Offline or blocked: the formulas stay as their source, and the next formula drawn tries again.
    script.onerror = () => { loading = null; script.remove(); resolve(); };
    document.head.appendChild(script);
  }).then(() => {
    if (!ready()) return;
    typesetPending();
    // Markup built before KaTeX was in can reach the page later (a question built ahead, an answer's
    // explanation): typeset whatever lands for the next minute, by which time nothing old is left to come.
    const watch = new MutationObserver(() => { if (document.querySelector(".math-pending")) typesetPending(); });
    watch.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => watch.disconnect(), 60_000);
  });
  return loading;
}

/** One formula as HTML: typeset if KaTeX is in; otherwise `fallback` (HTML, the formula as the caller shows it
 *  without KaTeX) in a placeholder that is typeset when KaTeX arrives. `onError` is shown if KaTeX can't read it. */
export function mathHtml(src, display, fallback, onError = fallback) {
  if (ready()) {
    try { return window.katex.renderToString(src, { displayMode: display, throwOnError: false }); }
    catch { return onError; }
  }
  if (typeof document === "undefined") return fallback;   // the unit tests, in Node
  loadMath();
  return `<span class="math-pending" data-tex="${esc(src)}"${display ? " data-display" : ""}>${fallback}</span>`;
}

function typesetPending() {
  if (!ready()) return;
  for (const node of document.querySelectorAll(".math-pending")) {
    try {
      node.outerHTML = window.katex.renderToString(node.dataset.tex, { displayMode: node.hasAttribute("data-display"), throwOnError: false });
    } catch {
      node.classList.remove("math-pending");
    }
  }
}

// Thin wrapper around vendored canvas-confetti, with reduced-motion respect. The library (vendor/, ~5 kB) is
// fetched the first time there is something to celebrate, not on every page load.
//
// The library's default instance draws in a Web Worker it builds from a blob: URL, which the
// site's Content-Security-Policy (worker-src falls back to default-src 'self') refuses — the
// library then quietly draws on the main thread anyway, but every burst logged a CSP error.
// One instance of our own, made with useWorker: false, draws on the main thread from the start.

let instance = null;
let loading = null;
let round = 0;   // clearConfetti() moves it on, so a burst still waiting for the library doesn't fire on the next screen
/** Start fetching the library now (a screen that may celebrate in a moment), so the burst keeps time. */
export function prepareConfetti() { loadLib(); }
function loadLib() {
  if (typeof window.confetti?.create === "function") return Promise.resolve();
  loading ??= new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "vendor/canvas-confetti.min.js";
    script.async = true;
    script.onload = resolve;
    script.onerror = () => { loading = null; script.remove(); resolve(); };   // no confetti this time; no error
    document.head.appendChild(script);
  });
  return loading;
}
function confettiFn() {
  const lib = window.confetti;
  if (typeof lib?.create !== "function") return null;
  instance ??= lib.create(null, { useWorker: false, resize: true });
  return instance;
}

export async function celebrate() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const mine = ++round;
  await loadLib();
  if (mine !== round) return;
  const fn = confettiFn();
  if (!fn) return;
  const colors = ["#3A6AE0", "#7A5CFF", "#2FA36B", "#F0913C", "#E4588A"];
  fn({ particleCount: 70, spread: 75, startVelocity: 40, origin: { y: 0.65 }, colors, disableForReducedMotion: true });
  setTimeout(() => fn({ particleCount: 40, angle: 60, spread: 55, origin: { x: 0 }, colors }), 120);
  setTimeout(() => fn({ particleCount: 40, angle: 120, spread: 55, origin: { x: 1 }, colors }), 120);
  setTimeout(() => { try { instance?.reset?.(); } catch {} }, 4000);
}

export function clearConfetti() {
  round++;
  try { instance?.reset?.(); } catch {}
}

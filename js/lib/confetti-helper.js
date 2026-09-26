// Thin wrapper around vendored canvas-confetti, with reduced-motion respect.
//
// The library's default instance draws in a Web Worker it builds from a blob: URL, which the
// site's Content-Security-Policy (worker-src falls back to default-src 'self') refuses — the
// library then quietly draws on the main thread anyway, but every burst logged a CSP error.
// One instance of our own, made with useWorker: false, draws on the main thread from the start.

let instance = null;
function confettiFn() {
  const lib = window.confetti;
  if (typeof lib?.create !== "function") return null;
  instance ??= lib.create(null, { useWorker: false, resize: true });
  return instance;
}

export function celebrate() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const fn = confettiFn();
  if (!fn) return;
  const colors = ["#3A6AE0", "#7A5CFF", "#2FA36B", "#F0913C", "#E4588A"];
  fn({ particleCount: 70, spread: 75, startVelocity: 40, origin: { y: 0.65 }, colors, disableForReducedMotion: true });
  setTimeout(() => fn({ particleCount: 40, angle: 60, spread: 55, origin: { x: 0 }, colors }), 120);
  setTimeout(() => fn({ particleCount: 40, angle: 120, spread: 55, origin: { x: 1 }, colors }), 120);
  setTimeout(() => { try { instance?.reset?.(); } catch {} }, 4000);
}

export function clearConfetti() {
  try { instance?.reset?.(); } catch {}
}

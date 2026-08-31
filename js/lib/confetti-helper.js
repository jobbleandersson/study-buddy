// Thin wrapper around vendored canvas-confetti, with reduced-motion respect.

export function celebrate() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const fn = window.confetti;
  if (typeof fn !== "function") return;
  const colors = ["#7A5CFF", "#4C7DF0", "#2FA36B", "#F0913C", "#E4588A"];
  fn({ particleCount: 70, spread: 75, startVelocity: 40, origin: { y: 0.65 }, colors, disableForReducedMotion: true });
  setTimeout(() => fn({ particleCount: 40, angle: 60, spread: 55, origin: { x: 0 }, colors }), 120);
  setTimeout(() => fn({ particleCount: 40, angle: 120, spread: 55, origin: { x: 1 }, colors }), 120);
  setTimeout(() => { try { window.confetti?.reset?.(); } catch {} }, 4000);
}

export function clearConfetti() {
  try { window.confetti?.reset?.(); } catch {}
}

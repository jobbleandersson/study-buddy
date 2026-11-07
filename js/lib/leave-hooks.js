// Things that must end when the student leaves a screen (read-aloud today). A module that starts such a thing
// registers how to stop it; main.js runs them on every real navigation. Kept tiny and apart so that main.js does
// not have to load the module that owns the thing (speech.js and what it pulls in, about 50 KB) on every visit,
// the front page included, only to be able to stop something that was never started.

const hooks = new Set();

/** Register `fn` to run when the student leaves a screen. Returns a function that takes it off again. */
export function onLeave(fn) { hooks.add(fn); return () => hooks.delete(fn); }

/** Run every registered hook; one that throws never stops the others or the navigation. */
export function runLeaveHooks() {
  for (const fn of [...hooks]) { try { fn(); } catch { /* a hook never breaks a navigation */ } }
}

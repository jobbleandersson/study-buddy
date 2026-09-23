// The js/lib modules under test are written for a browser: some of their
// functions call into lib/i18n.js, which reads/writes `localStorage` for the
// language choice. There's no DOM here, so calling those functions without a
// stub throws "localStorage is not defined" before the logic under test ever
// runs. This is a minimal in-memory stand-in - just enough that t()/getLang()
// resolve to the "sv" default instead of crashing.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

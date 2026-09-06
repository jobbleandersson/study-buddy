// "Make the practice library available offline" — the page asks the service
// worker to cache every set file so importing on the tunnelbana works. The
// SW does the walking (sw.js `cacheLibrary`); this is the page-side handle.

export function offlineSupported() {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator && "caches" in window;
}

async function activeWorker() {
  if (!offlineSupported()) return null;
  if (navigator.serviceWorker.controller) return navigator.serviceWorker.controller;
  try {
    const reg = await navigator.serviceWorker.ready;
    return reg.active || null;
  } catch {
    return null;
  }
}

/** Kick off caching. `onProgress(done, total)` fires as batches land.
 *  Resolves { ok, done, total } or { ok:false, reason }. */
export async function cacheLibraryOffline(onProgress) {
  const sw = await activeWorker();
  if (!sw) return { ok: false, reason: "no-sw" };
  return new Promise((resolve) => {
    const onMsg = (e) => {
      const d = e.data || {};
      if (d.type === "library-cache-progress") {
        onProgress && onProgress(d.done, d.total);
      } else if (d.type === "library-cache-done") {
        navigator.serviceWorker.removeEventListener("message", onMsg);
        resolve(d);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    // Safety net: don't hang forever if the SW goes away mid-run.
    setTimeout(() => {
      navigator.serviceWorker.removeEventListener("message", onMsg);
      resolve({ ok: false, reason: "timeout" });
    }, 180000);
    sw.postMessage({ type: "CACHE_LIBRARY" });
  });
}

/** Best-effort "is the library already cached?" — samples a few set files. */
export async function isLibraryCached() {
  if (!offlineSupported()) return false;
  const samples = [
    "data/library/ak9-matematik-tal.json",
    "data/library/gy-matematik-1-algebra.json",
    "data/library/ak7-bio-kroppen.json",
  ];
  try {
    const hits = await Promise.all(samples.map((u) => caches.match(u).then((r) => !!r).catch(() => false)));
    return hits.filter(Boolean).length >= 2;
  } catch {
    return false;
  }
}

// Anonymous error reports: a script error, an unhandled promise rejection or one of our own files
// failing to load is sent to the server, so a bug that only shows on a student's phone is seen at all.
// Like the pageview ping it carries nothing that identifies anyone: the message, where in our code it
// happened, the page (with ids and query strings removed), the app version and the browser family.
// At most MAX_PER_LOAD different errors per page load, each once. Server side:
// server/src/routes/client-errors.js; read them at #/admin/errors.

const MAX_PER_LOAD = 10;
// Errors we can't act on: browser add-ons, the browser's own resize warning, cross-origin scripts that
// hide their message ("Script error."), and requests that failed because the device is offline.
const EXTENSION = /(?:chrome|moz|safari|safari-web|ms-browser)-extension:\/\//i;
const NOISE = /^(?:Uncaught )?(?:ResizeObserver loop|Script error\.?$|(?:TypeError: )?(?:Failed to fetch|Load failed|NetworkError when attempting to fetch resource)|AbortError)/i;

/** The page a report came from, without anything personal: no query string (it can carry a token)
 *  and ids replaced, so "/results/5e1dfjnaqcrn" and "/verify?token=..." become "/results/:id", "/verify". */
export function sanitizeRoute(hash) {
  const path = String(hash || "").replace(/^#/, "").split("?")[0] || "/";
  return path.split("/").map((seg) => ((/\d/.test(seg) && seg.length >= 6) || seg.length > 40 ? ":id" : seg)).join("/").slice(0, 100);
}

/** "Chrome 129 · Android" — the family and major version only, never the full user-agent string. */
export function coarseBrowser(ua = "") {
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /CrOS/.test(ua) ? "ChromeOS"
    : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "other";
  // Checked in this order: Edge, Opera and Samsung Internet also say "Chrome", and Chrome says "Safari".
  const families = [["Edge", /Edg\/(\d+)/], ["Opera", /OPR\/(\d+)/], ["Samsung Internet", /SamsungBrowser\/(\d+)/],
    ["Firefox", /(?:Firefox|FxiOS)\/(\d+)/], ["Chrome", /(?:Chrome|CriOS)\/(\d+)/], ["Safari", /Version\/(\d+)[^ ]* (?:Mobile\/\S+ )?Safari/]];
  for (const [name, rx] of families) {
    const m = ua.match(rx);
    if (m) return `${name} ${m[1]} · ${os}`;
  }
  return `other · ${os}`;
}

/** Turns what an error event knows into a report, or null when it is noise we can't act on.
 *  `origin` is stripped from every URL, so the report points at our own files ("/js/views/hp.js:12:5"). */
export function shapeReport({ kind, message, source, stack, origin = "", hash = "", ua = "", version = null }) {
  const msg = String(message || "").replace(/\s+/g, " ").trim();
  if (!msg || NOISE.test(msg)) return null;
  if (EXTENSION.test(`${source || ""}\n${stack || ""}`)) return null;
  const local = (u) => {
    const s = String(u || "");
    return origin && s.startsWith(origin) ? s.slice(origin.length) || "/" : s;
  };
  const src = local(source);
  // Thrown by someone else's script (Google sign-in, a page translator): nothing we can fix.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(src)) return null;
  return {
    kind,
    message: msg.slice(0, 300),
    source: src.slice(0, 200) || null,
    stack: stack ? (origin ? String(stack).split(origin).join("") : String(stack)).slice(0, 1500) : null,
    route: sanitizeRoute(hash),
    version: version || null,
    browser: coarseBrowser(ua),
  };
}

// The app version is the service worker's cache name ("studify-v242"): the code this page runs.
let versionP = null;
function appVersion() {
  versionP ||= (async () => {
    try {
      const keys = (await caches.keys()).filter((k) => /^studify-v\d+$/.test(k));
      return keys.sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)))[0] || null;
    } catch { return null; }
  })();
  return versionP;
}

let installed = false;

/** Starts listening. Call once, as early as possible. Reporting never throws or logs an error itself. */
export function installErrorReporting(url) {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const sent = new Set();
  let n = 0;

  const send = async (raw) => {
    try {
      if (n >= MAX_PER_LOAD) return;
      const report = shapeReport({ ...raw, origin: location.origin, hash: location.hash, ua: navigator.userAgent, version: await appVersion() });
      if (!report) return;
      const key = `${report.kind}|${report.message}|${report.source}`;
      if (sent.has(key) || n >= MAX_PER_LOAD) return;
      sent.add(key);
      n++;
      const body = new Blob([JSON.stringify(report)], { type: "application/json" });
      if (!(navigator.sendBeacon && navigator.sendBeacon(url, body))) {
        fetch(url, { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => {});
      }
    } catch { /* reporting must never cause an error of its own */ }
  };

  // Capture phase, so a file that fails to load (an <img>, a <script>) is caught too; those events
  // don't bubble up to window.
  window.addEventListener("error", (e) => {
    const el = e.target;
    if (el && el !== window && el.tagName) {
      const src = String(el.currentSrc || el.src || el.href || "");
      // An inline data: image is ours too (a broken one is how the landing page's phone placeholder
      // failed unseen) — reported by its type, not its whole content.
      if (src) send({ kind: "resource", message: `${el.tagName.toLowerCase()} failed to load`, source: src.startsWith("data:") ? `${src.slice(0, 30)}…` : src });
      return;
    }
    send({
      kind: "error",
      message: e.message || e.error?.message,
      source: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : "",
      stack: e.error?.stack,
    });
  }, true);

  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    send({ kind: "rejection", message: r?.message ? `${r.name || "Error"}: ${r.message}` : String(r), stack: r?.stack });
  });
}

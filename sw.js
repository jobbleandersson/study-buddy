// StudyBuddy service worker.
//
// Strategy: network-first for same-origin GETs, falling back to the cache.
// Cache-first would be faster, but this app is under active development and
// stale-file confusion is worse than a few milliseconds. Offline still works
// because every successful response is cached on the way past.
//
// Anything cross-origin (api.anthropic.com, Google Fonts) is left entirely
// alone — API calls must never be served from a cache.

const CACHE = "studybuddy-v61";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./api/health",
  "./css/tokens.css",
  "./css/app.css",
  "./assets/favicon.svg",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./js/config.js",
  "./js/main.js",
  "./js/store.js",
  "./js/claude.js",
  "./js/prompts.js",
  "./js/material.js",
  "./js/lib/dom.js",
  "./js/lib/a11y.js",
  "./js/lib/activity.js",
  "./js/lib/theme.js",
  "./js/lib/i18n.js",
  "./js/lib/strings.js",
  "./js/lib/sound.js",
  "./js/lib/srs.js",
  "./js/lib/grade.js",
  "./js/lib/popover.js",
  "./js/lib/achievement-toast.js",
  "./js/lib/answer-match.js",
  "./js/lib/mastery.js",
  "./js/lib/markdown.js",
  "./js/lib/rich.js",
  "./js/lib/confetti-helper.js",
  "./js/lib/library.js",
  "./js/lib/library-content.js",
  "./js/lib/date-phrases.js",
  "./js/lib/speech.js",
  "./js/lib/expr.js",
  "./js/lib/offline.js",
  "./js/lib/share-card.js",
  "./js/lib/share-set.js",
  "./js/lib/achievements.js",
  "./js/lib/recap.js",
  "./js/lib/typeface.js",
  "./js/lib/import.js",
  "./js/lib/split.js",
  "./js/data/national-tests.js",
  "./js/data/library.js",
  "./js/views/menu.js",
  "./js/views/create.js",
  "./js/views/edit.js",
  "./js/views/session.js",
  "./js/views/results.js",
  "./js/views/progress.js",
  "./js/views/settings.js",
  "./js/views/login.js",
  "./js/views/parent-dashboard.js",
  "./js/views/gallery.js",
  "./js/views/library.js",
  "./js/views/exam-prep.js",
  "./js/views/solve.js",
  "./js/views/reference.js",
  "./js/views/calculator.js",
  "./js/views/achievements.js",
  "./js/views/leaderboard.js",
  "./js/views/print.js",
  "./js/views/teachback.js",
  "./js/components/questions.js",
  "./js/components/question-editor.js",
  "./js/components/tutor-chat.js",
  "./js/components/math-keypad.js",
  "./js/components/onboarding.js",
  "./js/components/command-palette.js",
  "./js/components/nav.js",
  "./js/components/confirm-dialog.js",
  "./js/components/subject-field.js",
  "./js/components/quick-add.js",
  "./js/components/reading-controls.js",
  "./js/components/mascot.js",
  "./js/components/calendar.js",
  "./js/components/goal-ring.js",
  "./vendor/canvas-confetti.min.js",
  "./vendor/katex.min.js",
  "./vendor/katex.min.css",
  "./vendor/pdf.min.js",
  "./vendor/jszip.min.js",
  "./data/samples/sample-assignment.json",
  "./data/samples/sample-test.json",
  "./data/samples/scripted-tutor.json",
  "./data/samples/sample-assignment.sv.json",
  "./data/samples/sample-test.sv.json",
  "./data/samples/scripted-tutor.sv.json",
  "./data/library/index.json",
  "./data/library/index.en.json",
  "./data/reference/formulas.sv.json",
  "./data/reference/formulas.en.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Individually, so one 404 can't fail the whole install.
    await Promise.all(APP_SHELL.map((url) =>
      cache.add(url).catch((e) => console.warn("[sw] skipped", url, e.message))));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

// "Make the library available offline" — the page asks, the SW walks
// data/library/index.json and caches every set file (Swedish + English) so
// importing a set on the tunnelbana works. Progress is posted back to the
// page. Idempotent: re-running just refreshes.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "CACHE_LIBRARY") {
    event.waitUntil(cacheLibrary(event.source));
  }
});

async function cacheLibrary(client) {
  const cache = await caches.open(CACHE);
  let index;
  try {
    index = await fetch("./data/library/index.json").then((r) => r.json());
  } catch {
    client && client.postMessage({ type: "library-cache-done", ok: false });
    return;
  }
  const urls = ["./data/library/index.json", "./data/library/index.en.json"];
  for (const s of index.sets || []) {
    if (!s.file) continue;
    urls.push("./" + s.file.replace(/^\.?\//, ""));
    urls.push("./" + s.file.replace(/^\.?\//, "").replace("data/library/", "data/library-en/"));
  }
  const total = urls.length;
  let done = 0;
  const BATCH = 12;
  for (let i = 0; i < urls.length; i += BATCH) {
    await Promise.all(urls.slice(i, i + BATCH).map(async (u) => {
      try {
        const r = await fetch(u);
        if (r.ok) await cache.put(u, r.clone());
      } catch { /* a missing English file just falls back to Swedish at import */ }
      done++;
    }));
    client && client.postMessage({ type: "library-cache-progress", done, total });
  }
  client && client.postMessage({ type: "library-cache-done", ok: true, done, total });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;   // never touch the API or fonts

  event.respondWith((async () => {
    try {
      const fresh = await fetch(request);
      if (fresh && fresh.ok) {
        const cache = await caches.open(CACHE);
        cache.put(request, fresh.clone());
      }
      return fresh;
    } catch {
      const cached = await caches.match(request);
      if (cached) return cached;
      // A navigation offline should still open the app shell.
      if (request.mode === "navigate") {
        const shell = await caches.match("./index.html");
        if (shell) return shell;
      }
      throw new Error("offline and not cached");
    }
  })());
});

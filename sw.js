// Studify service worker.
//
// Strategy: network-first for same-origin GETs, falling back to the cache.
// Cache-first would be faster, but this app is under active development and
// stale-file confusion is worse than a few milliseconds. Offline still works
// because every successful response is cached on the way past.
//
// Anything cross-origin (api.anthropic.com, Google Fonts) is left entirely
// alone — API calls must never be served from a cache.

const CACHE = "studify-v116";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./api/health",
  "./css/tokens.css",
  "./css/fonts.css",
  "./assets/fonts/inter-latin.woff2",
  "./assets/fonts/inter-latin-ext.woff2",
  "./assets/fonts/inter-italic-latin.woff2",
  "./assets/fonts/atkinson-400-latin.woff2",
  "./assets/fonts/atkinson-700-latin.woff2",
  "./assets/fonts/atkinson-400-italic-latin.woff2",
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
  "./js/lib/server-errors.js",
  "./js/lib/mastery.js",
  "./js/lib/markdown.js",
  "./js/lib/rich.js",
  "./js/lib/confetti-helper.js",
  "./js/lib/library.js",
  "./js/lib/library-content.js",
  "./js/lib/date-phrases.js",
  "./js/lib/hp.js",
  "./js/lib/figures.js",
  "./js/lib/spark.js",
  "./js/lib/speech.js",
  "./js/lib/lang-detect.js",
  "./js/lib/challenge.js",
  "./js/lib/expr.js",
  "./js/lib/offline.js",
  "./js/lib/share-card.js",
  "./js/lib/share-set.js",
  "./js/lib/achievements.js",
  "./js/lib/recap.js",
  "./js/lib/rules.js",
  "./js/lib/daily.js",
  "./js/lib/voice-answer.js",
  "./js/lib/check.js",
  "./js/lib/loose-json.js",
  "./js/lib/photo.js",
  "./js/lib/tonight.js",
  "./js/lib/typeface.js",
  "./js/lib/import.js",
  "./js/lib/split.js",
  "./js/data/national-tests.js",
  "./js/data/library.js",
  "./js/data/hp-content.js",
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
  "./js/views/calendar.js",
  "./js/views/exam-prep.js",
  "./js/views/hp.js",
  "./js/views/solve.js",
  "./js/views/reference.js",
  "./js/views/calculator.js",
  "./js/views/achievements.js",
  "./js/views/leaderboard.js",
  "./js/views/landing.js",
  "./js/views/teachers.js",
  "./js/views/legal.js",
  "./js/views/print.js",
  "./js/views/rules.js",
  "./js/components/daily-card.js",
  "./js/components/house-ad.js",
  "./js/components/class-daily-panel.js",
  "./js/components/bus-question.js",
  "./js/views/check.js",
  "./js/components/solve-tabs.js",
  "./js/views/tonight.js",
  "./js/components/rule-card.js",
  "./js/views/teachback.js",
  "./js/views/challenge.js",
  "./js/views/classes.js",
  "./js/components/class-wizard.js",
  "./js/components/class-share-slide.js",
  "./js/components/questions.js",
  "./js/components/question-editor.js",
  "./js/components/tutor-chat.js",
  "./js/components/math-keypad.js",
  "./js/components/onboarding.js",
  "./js/components/command-palette.js",
  "./js/components/site-chat.js",
  "./js/components/upgrade-prompt.js",
  "./js/components/challenge-dialog.js",
  "./js/components/nav.js",
  "./js/components/confirm-dialog.js",
  "./js/components/delete-account-dialog.js",
  "./js/components/due-dialog.js",
  "./js/components/subject-field.js",
  "./js/components/quick-add.js",
  "./js/components/reading-controls.js",
  "./js/components/file-drop.js",
  "./js/components/google-signin.js",
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
  "./data/library/hp-index.json",
  "./data/library/hp-index.en.json",
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
  // The main practice library plus the Högskoleprovet track, which keeps its
  // own small index (data/library/hp-index.json) separate from the curriculum
  // library — see js/data/hp-content.js.
  let sets = [];
  for (const idxUrl of ["./data/library/index.json", "./data/library/hp-index.json"]) {
    try {
      const idx = await fetch(idxUrl).then((r) => r.json());
      sets = sets.concat(idx.sets || []);
    } catch { /* one index unreachable — cache what we can */ }
  }
  if (!sets.length) {
    client && client.postMessage({ type: "library-cache-done", ok: false });
    return;
  }
  const urls = [
    "./data/library/index.json", "./data/library/index.en.json",
    "./data/library/hp-index.json", "./data/library/hp-index.en.json",
  ];
  const setFiles = [];
  for (const s of sets) {
    if (!s.file) continue;
    const rel = s.file.replace(/^\.?\//, "");
    urls.push("./" + rel);
    urls.push("./" + rel.replace("data/library/", "data/library-en/"));
    setFiles.push("./" + rel);
  }
  const total = urls.length;
  let done = 0;
  const BATCH = 12;
  const figures = new Set();
  for (let i = 0; i < urls.length; i += BATCH) {
    await Promise.all(urls.slice(i, i + BATCH).map(async (u) => {
      try {
        const r = await fetch(u);
        if (r.ok) {
          await cache.put(u, r.clone());
          // Högskoleprovet DTK/XYZ figures are referenced from the set JSON —
          // collect them so a "make offline" pass grabs the images too.
          if (setFiles.includes(u)) {
            try {
              const doc = await r.clone().json();
              for (const q of doc.questions || []) {
                if (q.figure && q.figure.src) figures.add("./data/library/figures/" + String(q.figure.src).replace(/^\.?\/*/, ""));
                if (q.stimulus && q.stimulus.figure && q.stimulus.figure.src) figures.add("./data/library/figures/" + String(q.stimulus.figure.src).replace(/^\.?\/*/, ""));
              }
            } catch { /* not JSON / malformed — skip */ }
          }
        }
      } catch { /* a missing English file just falls back to Swedish at import */ }
      done++;
    }));
    client && client.postMessage({ type: "library-cache-progress", done, total });
  }
  for (const f of figures) {
    try { const r = await fetch(f); if (r.ok) await cache.put(f, r.clone()); } catch { /* skip */ }
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
      // no-store: go past the browser's HTTP cache to the network, so an
      // updated file lands the first time you're online rather than after a
      // second reload. The CacheStorage copy below is the offline fallback.
      const fresh = await fetch(request, { cache: "no-store" });
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

// StudyBuddy service worker.
//
// Strategy: network-first for same-origin GETs, falling back to the cache.
// Cache-first would be faster, but this app is under active development and
// stale-file confusion is worse than a few milliseconds. Offline still works
// because every successful response is cached on the way past.
//
// Anything cross-origin (api.anthropic.com, Google Fonts) is left entirely
// alone — API calls must never be served from a cache.

const CACHE = "studybuddy-v1";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/tokens.css",
  "./css/app.css",
  "./assets/favicon.svg",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./js/main.js",
  "./js/store.js",
  "./js/claude.js",
  "./js/prompts.js",
  "./js/material.js",
  "./js/lib/dom.js",
  "./js/lib/a11y.js",
  "./js/lib/activity.js",
  "./js/lib/theme.js",
  "./js/lib/srs.js",
  "./js/lib/mastery.js",
  "./js/lib/markdown.js",
  "./js/lib/rich.js",
  "./js/lib/confetti-helper.js",
  "./js/views/menu.js",
  "./js/views/create.js",
  "./js/views/edit.js",
  "./js/views/session.js",
  "./js/views/results.js",
  "./js/views/progress.js",
  "./js/views/settings.js",
  "./js/components/questions.js",
  "./js/components/question-editor.js",
  "./js/components/tutor-chat.js",
  "./js/components/mascot.js",
  "./vendor/canvas-confetti.min.js",
  "./vendor/katex.min.js",
  "./vendor/katex.min.css",
  "./vendor/pdf.min.js",
  "./data/samples/sample-assignment.json",
  "./data/samples/sample-test.json",
  "./data/samples/scripted-tutor.json",
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

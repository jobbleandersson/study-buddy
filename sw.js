// PluggEra service worker.
//
// Strategy: the app's own files (APP_SHELL and LANG_FILES below) come straight from this version's
// cache. Asking the server about each of them first cost a phone ~70 round trips before the menu
// on every open. That is only safe because the version is never set by hand: the server replaces
// BUILD with a hash of every file listed here (server/src/sw-build.js), so a deploy that changes
// any of them is a new service worker with a fresh cache, and one that changes none is not. The
// page itself (navigation) and everything else same-origin stay network-first, cached on the way
// past for offline. Served without the server (serve.ps1, a static host) BUILD stays "dev", and
// everything is network-first as before, so local edits show on reload.
//
// Anything cross-origin (api.anthropic.com, Google Fonts) is left entirely
// alone — API calls must never be served from a cache.

const BUILD = "dev";
const CACHE = `studify-${BUILD}`;
const VERSIONED = BUILD !== "dev";

// Left out on purpose (a phone's first visit downloads all of this): the PDF and zip readers, only
// used to make a set from a file, which needs the AI and so a connection anyway; the extended-Latin
// and Atkinson Hyperlegible fonts, only for rare letters and one setting. Each is cached below the
// first time it's used.
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/tokens.css",
  "./css/fonts.css",
  "./assets/fonts/inter-latin.woff2",
  "./assets/fonts/lexend-700-latin.woff2",
  "./assets/fonts/inter-italic-latin.woff2",
  "./css/app.css",
  "./css/design.css",
  "./css/landing.css",
  "./assets/favicon.svg",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./js/config.js",
  "./js/boot.js",
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
  "./js/lib/strings.sv.js",
  "./js/lib/sound.js",
  "./js/lib/srs.js",
  "./js/lib/merge-state.js",
  "./js/lib/image-size.js",
  "./js/lib/session-active.js",
  "./js/lib/choices.js",
  "./js/lib/review.js",
  "./js/lib/grade.js",
  "./js/lib/popover.js",
  "./js/lib/achievement-toast.js",
  "./js/lib/answer-match.js",
  "./js/lib/text.js",
  "./js/lib/server-errors.js",
  "./js/lib/mastery.js",
  "./js/lib/markdown.js",
  "./js/lib/rich.js",
  "./js/lib/confetti-helper.js",
  "./js/lib/library.js",
  "./js/lib/library-content.js",
  "./js/lib/date-phrases.js",
  "./js/lib/hp.js",
  "./js/lib/error-report.js",
  "./js/lib/figures.js",
  "./js/lib/spark.js",
  "./js/lib/speech.js",
  "./js/lib/lang-detect.js",
  "./js/lib/challenge.js",
  "./js/lib/exam-nav.js",
  "./js/lib/expr.js",
  "./js/lib/study-modes.js",
  "./js/lib/passages.js",
  "./js/lib/chat-history.js",
  "./js/lib/chat-material.js",
  "./js/lib/podcast.js",
  "./js/lib/set-brief.js",
  "./js/lib/offline.js",
  "./js/lib/share-card.js",
  "./js/lib/share-set.js",
  "./js/lib/achievements.js",
  "./js/lib/rules.js",
  "./js/lib/daily.js",
  "./js/lib/voice-answer.js",
  "./js/lib/check.js",
  "./js/lib/check-eval.js",
  "./js/lib/loose-json.js",
  "./js/lib/photo.js",
  "./js/lib/tonight.js",
  "./js/lib/exam.js",
  "./js/lib/typeface.js",
  "./js/lib/import.js",
  "./js/lib/split.js",
  "./js/lib/blank-questions.js",
  "./js/data/national-tests.js",
  "./js/data/library.js",
  "./js/data/hp-content.js",
  "./js/data/reviews.js",
  "./js/views/menu.js",
  "./js/views/create.js",
  "./js/views/edit.js",
  "./js/views/session.js",
  "./js/views/results.js",
  "./js/views/progress.js",
  "./js/views/profile.js",
  "./js/views/settings.js",
  "./js/views/login.js",
  "./js/views/verify-email.js",
  "./js/views/reset-password.js",
  "./js/views/parent-dashboard.js",
  "./js/views/gallery.js",
  "./js/views/library.js",
  "./js/views/calendar.js",
  "./js/views/exam-prep.js",
  "./js/views/hp.js",
  "./js/views/hp-delprov.js",
  "./js/views/hp-prov.js",
  "./js/views/solve.js",
  "./js/views/reference.js",
  "./js/views/calculator.js",
  "./js/views/achievements.js",
  "./js/views/leaderboard.js",
  "./js/views/landing.js",
  "./js/views/teachers.js",
  "./js/views/legal.js",
  "./js/views/contact.js",
  "./js/views/premium-waitlist.js",
  "./js/views/rate.js",
  "./js/views/admin-reviews.js",
  "./js/views/admin-errors.js",
  "./js/views/print.js",
  "./js/views/rules.js",
  "./js/components/daily-card.js",
  "./js/components/house-ad.js",
  "./js/components/class-daily-panel.js",
  "./js/components/bus-question.js",
  "./js/views/check.js",
  "./js/views/check-eval.js",
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
  "./js/components/material-picker.js",
  "./js/components/chat-history-panel.js",
  "./js/components/talk-player.js",
  "./js/components/set-proposal-card.js",
  "./js/components/command-palette.js",
  "./js/components/site-chat.js",
  "./js/components/upgrade-prompt.js",
  "./js/components/challenge-dialog.js",
  "./js/components/ai-gate.js",
  "./js/components/nav.js",
  "./js/components/confirm-dialog.js",
  "./js/components/delete-account-dialog.js",
  "./js/components/twofa-setup-dialog.js",
  "./js/components/password-confirm-dialog.js",
  "./js/components/set-password-dialog.js",
  "./js/components/site-gate-dialog.js",
  "./js/components/due-dialog.js",
  "./js/components/exam-dialog.js",
  "./js/components/exam-more.js",
  "./js/components/hp-more.js",
  "./js/components/exam-flow.js",
  "./js/components/set-ui.js",
  "./js/components/avatar-editor.js",
  "./js/components/subject-field.js",
  "./js/components/quick-add.js",
  "./js/components/reading-controls.js",
  "./js/components/voice-controls.js",
  "./js/components/file-drop.js",
  "./js/components/google-signin.js",
  "./js/components/password-field.js",
  "./js/components/mascot.js",
  "./js/components/ai-head.js",
  "./js/components/calendar.js",
  "./js/components/goal-ring.js",
  "./vendor/canvas-confetti.min.js",
  "./vendor/katex.min.js",
  "./vendor/katex.min.css",
  "./data/samples/sample-assignment.json",
  "./data/samples/sample-test.json",
  "./data/samples/scripted-tutor.json",
  "./data/samples/sample-assignment.sv.json",
  "./data/samples/sample-test.sv.json",
  "./data/samples/scripted-tutor.sv.json",
  "./data/library/index.json",
  "./data/library/hp-index.json",
  "./data/library/hp-index.en.json",
  "./data/reference/formulas.sv.json",
];

// What only an English page uses (most students use Swedish): precached for no one, and cached for a
// page as soon as it says it's in English (main.js posts SET_LANG on load, on a switch and when a new
// worker takes over), so it's there offline after the next deploy too.
const LANG_FILES = {
  en: ["./js/lib/strings.en.js", "./data/library/index.en.json", "./data/reference/formulas.en.json"],
};

// The files served from the cache (by full URL, no query). The page itself isn't: see the top.
const OWN_FILES = new Set([...APP_SHELL, ...Object.values(LANG_FILES).flat()]
  .filter((u) => u !== "./" && u !== "./index.html")
  .map((u) => new URL(u, self.location.href).href));

/** Fetches a file of this version into the cache. "no-cache" so the HTTP cache can't hand back an
 *  older copy (an unchanged file is a cheap 304). The server stamps every file with the build it
 *  belongs to (X-Build); during a rolling deploy a file can come from a machine still on the old
 *  build, and caching it here would serve it for this whole version - that throws instead. */
async function addFresh(cache, url) {
  const res = await fetch(new Request(url, { cache: "no-cache" }));
  if (!res.ok) throw new Error(`${res.status}`);
  const build = res.headers.get("X-Build");
  if (VERSIONED && build && build !== BUILD) throw new Error(`build ${build}, not ${BUILD}`);
  await cache.put(url, res);
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    let mixed = false;
    // Individually, so one 404 can't fail the whole install (a missing file is fetched when used).
    // A file from another build can: the browser tries the install again on the next visit.
    await Promise.all(APP_SHELL.map((url) => addFresh(cache, url).catch((e) => {
      if (/^build /.test(e.message)) mixed = true;
      console.warn("[sw] skipped", url, e.message);
    })));
    if (mixed) { await caches.delete(CACHE); throw new Error("files from two builds; trying again later"); }
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
  if (event.data && event.data.type === "SET_LANG") event.waitUntil(cacheLang(event.data.lang));
});

async function cacheLang(lang) {
  const files = LANG_FILES[lang];
  if (!files) return;
  const cache = await caches.open(CACHE);
  await Promise.all(files.map(async (url) => {
    if (!(await cache.match(url))) await addFresh(cache, url).catch((e) => console.warn("[sw] skipped", url, e.message));
  }));
}

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
  // The app's own API is same-origin too, and answers with someone's private data (/api/state is
  // the whole study blob, /api/auth/me their email). Caching those would leave them behind after
  // sign-out or account deletion — and let an offline boot come up "signed in" as a previous
  // person from a stale copy — so they always go straight to the network, never through the cache.
  if (url.pathname.includes("/api/")) return;

  // The app's own files: this version's copy, without asking the server (see the top). One that
  // isn't in the cache yet (a skipped install fetch, a language file) is fetched and kept.
  if (VERSIONED && request.mode !== "navigate" && !url.search && OWN_FILES.has(url.href)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(request, { ignoreVary: true });
      if (hit) return hit;
      const res = await fetch(request, { cache: "no-cache" });
      const build = res.headers.get("X-Build");
      if (res.ok && (!build || build === BUILD)) cache.put(request, res.clone());
      return res;
    })());
    return;
  }

  event.respondWith((async () => {
    try {
      // Always ask the server whether the file is still current, so an updated one
      // lands the first time you're online rather than after a second reload. "no-cache"
      // (not "no-store") lets the browser send its stored copy's ETag, and the server
      // answers an unchanged file with an empty 304 instead of the whole body again - the
      // difference between a page load costing about 3 MB and costing a few hundred bytes.
      // Fonts and the vendored libraries are the exception: they never change under the
      // same name and the server gives them a long lifetime, so the HTTP cache may answer
      // without any request at all. The CacheStorage copy below is the offline fallback.
      const stable = /\/(assets\/fonts|vendor)\//.test(url.pathname);
      const fresh = await fetch(request, { cache: stable ? "default" : "no-cache" });
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

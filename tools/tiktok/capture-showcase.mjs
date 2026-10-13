// Photographs the real app for the showcase video (showcase.js): every screen it shows, at phone size
// (390×844, three device pixels per px), from a local copy of the site with a demo student's progress
// in the browser's own storage. No account and no server: /api is answered locally, and nothing
// leaves this machine. Run it again whenever the app's look changes, then render the video:
//
//   node tools/tiktok/capture-showcase.mjs
//   node tools/tiktok/render-videos.mjs showcase
//
// Output: tools/tiktok/out/showcase/ — the shots (JPEG) and shots.json (their sizes, and where the
// buttons the video taps sit, in CSS px).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, wait } from "./headless.mjs";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "out", "showcase");
const W = 390, H = 844, SCALE = 3;
let authed = false;
const API = (p) => ({
  health: { ok: true, keyConfigured: true, messagesRequireAuth: true },
  "auth/me": authed ? { authed: true, email: "demo@exempel.se", emailVerified: true } : { authed: false },
  state: { version: 1, blob: null },
})[p];

const manifest = { width: W, height: H, scale: SCALE, shots: {}, rects: {} };

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const b = await launch({ width: W, height: H, scale: SCALE, mobile: true, api: API });
try {
  // The site chat's round button and the "achievement unlocked" toasts the demo progress sets off would
  // sit on top of every screen; the video has no use for them.
  await b.send("Page.addScriptToEvaluateOnNewDocument", { source: `addEventListener("DOMContentLoaded", () => {
    const s = document.createElement("style"); s.textContent = ".sitechat__fab, .sitechat__panel, .achtoast { display: none !important; }"; document.head.append(s); });` });

  const go = async (hash, ms = 1500) => { await b.evaluate(`location.hash = ${JSON.stringify(hash)}; scrollTo(0, 0); 1`); await wait(ms); };
  const rect = (expr) => b.evaluate(`(() => { const e = ${expr}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y + scrollY, w: r.width, h: r.height }; })()`);
  const save = (name, data) => fs.writeFileSync(path.join(OUT, `${name}.jpg`), Buffer.from(data, "base64"));
  const jpeg = async (clip, beyond = false) => (await b.send("Page.captureScreenshot", { format: "jpeg", quality: 92, captureBeyondViewport: beyond, clip: { ...clip, scale: 1 } })).data;
  /** What's on the screen. */
  const shot = async (name) => { save(name, await jpeg({ x: 0, y: 0, width: W, height: H })); manifest.shots[name] = { file: `${name}.jpg`, h: H }; };
  /** The whole page, for scrolling, with its fixed bars hidden (the video lays them over it). */
  const page = async (name, hide) => {
    await b.evaluate(`(() => { const s = document.createElement("style"); s.id = "cap-hide"; s.textContent = ${JSON.stringify(`${hide} { visibility: hidden !important; }`)}; document.head.append(s); return 1; })()`);
    const h = Math.min(4000, await b.evaluate("Math.ceil(document.documentElement.scrollHeight)"));
    save(name, await jpeg({ x: 0, y: 0, width: W, height: h }, true));
    await b.evaluate(`document.getElementById("cap-hide").remove(); 1`);
    await b.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: SCALE, mobile: true, screenWidth: W, screenHeight: H });
    await wait(300);
    manifest.shots[name] = { file: `${name}.jpg`, h };
  };
  /** One fixed bar on its own, to lay over a scrolling page. */
  const strip = async (name, selector) => {
    const r = await rect(`document.querySelector(${JSON.stringify(selector)})`);
    save(name, await jpeg({ x: 0, y: r.y, width: W, height: Math.ceil(r.h) }));
    manifest.shots[name] = { file: `${name}.jpg`, h: Math.ceil(r.h), y: r.y };
  };
  /** The innermost visible element matching `selector` whose text matches `re`. */
  const byText = (selector, re) => `[...document.querySelectorAll(${JSON.stringify(selector)})].filter((e) => ${re}.test(e.textContent) && e.offsetParent !== null).at(-1)`;

  // 1. The front page, as a first-time visitor sees it.
  await b.open(`${b.base}/assets/favicon.svg`);
  await b.evaluate(`localStorage.clear(); localStorage.setItem("studybuddy.lang", "sv"); localStorage.setItem("studybuddy.theme", "light"); 1`);
  await b.open(`${b.base}/`, `!!document.querySelector(".lp-head")`);
  await wait(1500);
  await shot("landing");
  await strip("landing-head", ".lp-head");
  await page("landing-page", ".lp-head");
  manifest.rects.landingStats = await rect(`document.querySelector(".lp-stats__inner")`);

  // 2. A demo student: ten days of practice across three subjects and every HP delprov (timed, so the
  //    HP hub shows its estimate), a profile and the test day.
  await b.open(`${b.base}/assets/favicon.svg`);
  await b.evaluate(`localStorage.clear(); localStorage.setItem("studybuddy.lang", "sv"); localStorage.setItem("studybuddy.theme", "light"); localStorage.setItem("studybuddy.onboarded", "1"); localStorage.setItem("studybuddy.shortcutTipSeen", "1"); 1`);
  await b.open(`${b.base}/#/`, `!!document.querySelector(".topbar")`);
  for (const id of ["lib-ma9-procent", "lib-sv9-ordklasser", "lib-en9-tenses"]) await go(`#/start/${id}`, 900);
  await go("#/hp", 2500);
  const seeded = await b.evaluate(`(async () => {
    const { store } = await import("/js/store.js");
    await (await import("/js/data/hp-content.js")).ensureHpSets();
    const now = Date.now();
    const record = (a, share, d, extra = {}) => {
      const qs = a.questions;
      store.recordAttempt({ id: "demo-" + a.id + "-" + d, assignmentId: a.id, title: a.title, retryHash: null, wasTest: false, examMode: false,
        startedAt: now - d * 864e5 - 9e5, finishedAt: now - d * 864e5, scorePct: Math.round(share * 100), tutorHints: 0, ...extra,
        items: qs.map((q, i) => { const ok = (i * 7 + d) % 10 < share * 10; return { questionId: q.id, topic: q.topic, correct: ok, firstTry: ok, srsGrade: ok ? "good" : "again", hintsUsed: 0 }; }) });
    };
    const school = [["lib-ma9-procent", .85], ["lib-sv9-ordklasser", .75], ["lib-en9-tenses", .7]];
    for (let d = 9; d >= 0; d--) for (const [id, share] of school.slice(0, d % 3 + 1)) { const a = store.getAssignment(id); if (a) record(a, share, d); }
    const hp = { ord: .7, las: .8, mek: .7, elf: .7, xyz: .7, kva: .7, nog: .6, dtk: .7 };
    Object.entries(hp).forEach(([dp, share], k) => { const a = store.getAssignment("lib-hp-2026v-" + dp); if (a) record(a, share, 1 + (k % 5), { hp: true, timeLimitMin: 12 }); });
    store.update((s) => { const days = []; for (let d = 0; d < 12; d++) { const x = new Date(now - d * 864e5); days.push(x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0")); } s.activity.daysStudied = [...new Set([...s.activity.daysStudied, ...days])]; });
    store.saveProfile({ name: "Alva", role: "student", level: "gy", goal: "hp", completedAt: now - 40 * 864e5 });
    store.setHpDate("2026-10-18");
    return store.attempts.filter((a) => a.hp).length;
  })()`);
  if (seeded < 8) throw new Error(`Only ${seeded} of the 8 HP delprov got demo results; the HP hub would show no estimate.`);
  // A fresh start, so the app opens as a returning student would see it (no first-visit welcome).
  // (Via a blank page: from #/hp to #/ alone would only change the hash, not reload.)
  await b.open("about:blank", "true");
  await b.open(`${b.base}/#/`, `!!document.querySelector(".topbar")`);
  await wait(1200);

  // 3. Home and the library (with the app's bars on their own, for scrolling).
  await go("#/", 1500);
  await shot("home");
  await go("#/library", 1500);
  await shot("library");
  await strip("app-top", ".topbar");
  await strip("app-tab", ".tabbar");
  await page("library-page", ".topbar, .tabbar");

  // 4. A question: as it opens, with the right answer picked, and checked.
  await go("#/start/lib-ma9-procent", 1800);
  await shot("q-0");
  const right = await b.evaluate(`(async () => {
    const { store } = await import("/js/store.js");
    const buttons = [...document.querySelectorAll("button.choice")];
    const tex = (btn) => [...btn.querySelectorAll("annotation")].map((a) => a.textContent.trim()).join(" ") || btn.lastElementChild.textContent.trim();
    const shown = buttons.map(tex);
    const strip = (s) => String(s).replace(/^\\$|\\$$/g, "").trim();
    const q = store.getAssignment("lib-ma9-procent").questions.find((x) => Array.isArray(x.choices) && x.choices.every((c) => shown.includes(strip(c)) || shown.includes(String(c))));
    if (!q) return -1;
    const want = strip(q.choices[q.answer]);
    return shown.findIndex((s) => s === want || s === String(q.choices[q.answer]));
  })()`);
  if (right < 0) throw new Error("Couldn't tell which option is right on the question screen.");
  manifest.rects.rightChoice = await rect(`document.querySelectorAll("button.choice")[${right}]`);
  await b.evaluate(`document.querySelectorAll("button.choice")[${right}].click(); 1`);
  await wait(500);
  await shot("q-1");
  manifest.rects.check = await rect(byText("button", /Rätta svaret/));
  await b.evaluate(`${byText("button", /Rätta svaret/)}.click(); 1`);
  await wait(1200);
  await shot("q-2");
  manifest.rects.feedback = await rect(`document.querySelector(".feedback.ok, .feedback")`);

  // 5. Högskoleprovet, with the estimate.
  await go("#/hp", 2500);
  await shot("hp");
  manifest.rects.hpEstimate = await rect(`${byText("section, div, article", /Uppskattad normerad poäng/)}.closest(".card, section, article") || ${byText("section, div, article", /Uppskattad normerad poäng/)}`);

  // 6. The formula collection, typing a search one letter at a time.
  await go("#/reference", 1500);
  await shot("ref-0");
  manifest.rects.refSearch = await rect(`document.querySelector("main input[type=search], main input")`);
  const word = "hypotenusa";
  for (let k = 1; k <= word.length; k++) {
    await b.evaluate(`(() => { const i = document.querySelector("main input[type=search], main input"); i.value = ${JSON.stringify(word.slice(0, k))}; i.dispatchEvent(new Event("input", { bubbles: true })); return 1; })()`);
    await wait(220);
    await shot(`ref-${k}`);
  }

  // 7. The profile and the progress page.
  await go("#/profile", 1800);
  await shot("profile");
  manifest.rects.idcard = await rect(`document.querySelector(".idcard")`);
  await go("#/progress", 1800);
  await shot("progress");

  // 8. PluggEra AI as a signed-in student sees it (signed out, it asks you to sign in first).
  authed = true;
  await b.open("about:blank", "true");
  await b.open(`${b.base}/#/solve`, `!!document.querySelector(".topbar")`);
  await wait(1800);
  await shot("solve");

  fs.writeFileSync(path.join(OUT, "shots.json"), JSON.stringify(manifest, null, 2));
  console.log(`${Object.keys(manifest.shots).length} shots in ${OUT}`);
  console.log(JSON.stringify(manifest.rects));
} finally {
  await b.close();
}

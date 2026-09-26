// Takes the screenshots the front page shows (assets/shots/*.jpg) from the real app, so they stay
// true to what a student actually sees: a study session, and the home page the hero shows. Rerun
// after changing either screen:
//
//   cd server && npm start            # in one terminal (any local server works)
//   node tools/landing-shots.mjs      # in another; or pass a base URL: node tools/landing-shots.mjs http://localhost:8787
//
// Needs Playwright (npx playwright, or a global install). It opens a ready-made library set in a
// fresh browser, the same way a visitor would, in each language. The only thing it changes on the
// page is the tutor's "demo mode" subtitle, which a local server without a Claude key shows: it's
// swapped for the live-mode label every real student sees.

import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { chromium } = await import("playwright");
const base = process.argv[2] || "http://localhost:8787";
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "shots");
mkdirSync(out, { recursive: true });

const LIVE_LABEL = { sv: "din handledare", en: "your tutor" };
const SET = "lib-ma9-procent";

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
// Desktop for the framed shot on wide screens; phone for narrow ones, where a shrunken desktop
// screenshot would be unreadable.
const SIZES = [
  ["", { width: 1280, height: 800 }, 1.5],
  ["-phone", { width: 390, height: 780 }, 2],
];
for (const lang of ["sv", "en"]) for (const [suffix, viewport, scale] of SIZES) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, colorScheme: "light" });
  const page = await ctx.newPage();
  await page.addInitScript((l) => {
    localStorage.setItem("studybuddy.lang", l);
    localStorage.setItem("studybuddy.shortcutTipSeen", "1");
    localStorage.setItem("studybuddy.theme", "light");
  }, lang);
  await page.goto(`${base}/#/start/${SET}`);
  await page.waitForURL(/#\/session\//);
  await page.waitForTimeout(1500);
  const skip = page.getByRole("button", { name: lang === "sv" ? "Hoppa över allt" : "Skip all" });
  if (await skip.count()) { await skip.first().click(); await page.waitForTimeout(600); }
  // Mid-session rather than untouched: the right answer (C, "20 kr") picked, not yet checked.
  await page.getByRole("button", { name: /20/ }).first().click();
  await page.waitForTimeout(300);
  await page.evaluate((label) => {
    for (const n of document.querySelectorAll("*")) {
      if (n.children.length === 0 && /demo/i.test(n.textContent) && /handledare|tutor/.test(n.textContent)) n.textContent = label;
    }
    document.querySelectorAll(".toast").forEach((n) => n.remove());
  }, LIVE_LABEL[lang]);
  // The phone layout puts the tutor below the question; hide the floating chat button so the
  // shot shows the question and its choices, not a button over them.
  await page.addStyleTag({ content: ".sitechat__fab, .hintfab { display: none !important; }" });
  await page.screenshot({ path: join(out, `session${suffix}-${lang}.jpg`), type: "jpeg", quality: 82 });
  console.log(`wrote assets/shots/session${suffix}-${lang}.jpg`);
  await ctx.close();
}
// The hero's home-page shot: a student a few sets in — three library sets added and one round of
// each done — so the page shows what it looks like in use rather than empty.
const HOME_SETS = [["lib-ma9-procent", 0.75], ["lib-sv9-ordklasser", 0.9], ["lib-en9-tenses", 0.6]];
for (const lang of ["sv", "en"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, colorScheme: "light" });
  const page = await ctx.newPage();
  await page.addInitScript((l) => {
    localStorage.setItem("studybuddy.lang", l);
    localStorage.setItem("studybuddy.shortcutTipSeen", "1");
    localStorage.setItem("studybuddy.theme", "light");
  }, lang);
  for (const [id] of HOME_SETS) {
    await page.goto(`${base}/#/start/${id}`);
    await page.waitForURL(/#\/session\//);
    await page.waitForTimeout(500);
  }
  await page.evaluate(async (sets) => {
    const { store } = await import("/js/store.js");
    const now = Date.now();
    sets.forEach(([id, share], n) => {
      const a = store.getAssignment(id);
      const qs = a.questions.slice(0, 12);
      store.recordAttempt({
        id: `shot-${n}`, assignmentId: a.id, title: a.title, retryHash: null, wasTest: false, examMode: false,
        startedAt: now - 600000 * (n + 1), finishedAt: now - 540000 * n, scorePct: Math.round(share * 100), tutorHints: 1,
        items: qs.map((q, i) => {
          const ok = i < Math.round(share * qs.length);
          return { questionId: q.id, topic: q.topic, correct: ok, firstTry: ok, srsGrade: ok ? "good" : "again", hintsUsed: 0 };
        }),
      });
    });
  }, HOME_SETS);
  await page.goto(`${base}/#/`);
  await page.waitForTimeout(1500);
  await page.addStyleTag({ content: ".sitechat__fab, .house-ad, .toast, .achtoast { display: none !important; } html { scrollbar-gutter: auto; overflow-y: hidden; }" });
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(out, `home-${lang}.jpg`), type: "jpeg", quality: 84 });
  console.log(`wrote assets/shots/home-${lang}.jpg`);
  await ctx.close();
}
await browser.close();

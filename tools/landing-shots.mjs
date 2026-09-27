// Takes the screenshot the front page's hero shows (assets/shots/home-*.jpg) from the real app, so
// it stays true to what a student actually sees. Rerun after changing the home page:
//
//   cd server && npm start            # in one terminal (any local server works)
//   node tools/landing-shots.mjs      # in another; or pass a base URL: node tools/landing-shots.mjs http://localhost:8787
//
// Needs Playwright (npx playwright, or a global install). In a fresh browser, in each language, it
// adds three library sets the way a visitor would, records one round of each, and shoots the home
// page with the chat button, toasts and the library tip hidden.

import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { chromium } = await import("playwright");
const base = process.argv[2] || "http://localhost:8787";
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "shots");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

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

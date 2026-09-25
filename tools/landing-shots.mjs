// Takes the screenshots the front page shows (assets/shots/*.jpg) from the real app, so they stay
// true to what a student actually sees. Rerun after changing the study-session screen:
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
for (const lang of ["sv", "en"]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5, colorScheme: "light" });
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
  await page.screenshot({ path: join(out, `session-${lang}.jpg`), type: "jpeg", quality: 82 });
  console.log(`wrote assets/shots/session-${lang}.jpg`);
  await ctx.close();
}
await browser.close();

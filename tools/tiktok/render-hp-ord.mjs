// Renders "Dagens HP-ord" images for TikTok from the ORD word bank: for each word a question image
// and an answer image (1080×1920 PNG), plus captions.txt with a ready caption per word. The layout is
// hp-ord.html next to this file; the words, options and explanations come straight from
// data/library/hp-ord-bank-01.json, so the images always match what the app teaches.
//
//   node tools/tiktok/render-hp-ord.mjs              # every word
//   node tools/tiktok/render-hp-ord.mjs --from 1 --to 10
//
// Output: tools/tiktok/out/ (kept out of git and out of fly deploy). No npm packages: it drives an
// installed Chrome, Edge or Chromium over the DevTools protocol. Set BROWSER=/path/to/it if the
// script doesn't find one.

import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const OUT = path.join(HERE, "out");
const BANK = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "library", "hp-ord-bank-01.json"), "utf8"));

const arg = (name, fallback) => {
  const k = process.argv.indexOf(`--${name}`);
  return k > 0 ? Number(process.argv[k + 1]) : fallback;
};
const FROM = Math.max(1, arg("from", 1));
const TO = Math.min(BANK.questions.length, arg("to", BANK.questions.length));

const BROWSERS = [
  process.env.BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge",
].filter(Boolean);
const BROWSER = BROWSERS.find((b) => fs.existsSync(b));
if (!BROWSER) {
  console.error("No Chrome, Edge or Chromium found. Run again with BROWSER=/path/to/the/browser.");
  process.exit(1);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
const wordOf = (q) => q.prompt.match(/\*\*(.+?)\*\*/)[1];
const slug = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");

// A static server for the repo, so the page can load the word bank, the fonts and the logo.
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
const port = await new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)));
const BASE = `http://127.0.0.1:${port}/tools/tiktok/hp-ord.html`;

const debug = await freePort();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "hp-ord-"));
const browser = spawn(BROWSER, [
  "--headless=new", `--remote-debugging-port=${debug}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--force-color-profile=srgb", "about:blank",
], { stdio: "ignore" });

let ws;
try {
  let target = null;
  for (let k = 0; k < 80 && !target; k++) {
    await wait(250);
    try { target = (await (await fetch(`http://127.0.0.1:${debug}/json/list`)).json()).find((t) => t.type === "page"); } catch { /* not up yet */ }
  }
  if (!target) throw new Error(`The browser didn't start: ${BROWSER}`);

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (!m.id || !pending.has(m.id)) return;
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result);
  });
  const send = (method, params = {}) => new Promise((res, rej) => { pending.set(++id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true })).result.value;

  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1080, height: 1920, deviceScaleFactor: 1, mobile: false });
  fs.mkdirSync(OUT, { recursive: true });

  const captions = [];
  for (let n = FROM; n <= TO; n++) {
    const q = BANK.questions[n - 1];
    const word = wordOf(q);
    for (const [frame, label] of [["q", "1-fraga"], ["a", "2-svar"]]) {
      await send("Page.navigate", { url: `${BASE}?i=${n - 1}&frame=${frame}&n=${n}` });
      let ready = false;
      for (let k = 0; k < 80 && !ready; k++) { await wait(100); ready = await evaluate(`document.body?.dataset.ready === "1"`).catch(() => false); }
      if (!ready) throw new Error(`The page never finished drawing "${word}" (${frame}).`);
      // TikTok draws its caption and sound line over the bottom ~470px; anything there gets covered.
      const fit = await evaluate(`(() => {
        const main = document.querySelector(".main"), brand = document.querySelector(".brand").getBoundingClientRect();
        return { low: main.lastElementChild.getBoundingClientRect().bottom > 1450, high: main.firstElementChild.getBoundingClientRect().top < brand.bottom };
      })()`);
      if (fit.low || fit.high) console.warn(`  ! "${word}" (${frame}) doesn't fit the safe area — shorten its explanation or options`);
      const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1080, height: 1920, scale: 1 } });
      fs.writeFileSync(path.join(OUT, `hp-ord-${String(n).padStart(2, "0")}-${slug(word)}-${label}.png`), Buffer.from(shot.data, "base64"));
    }
    captions.push(
      `#${n} ${word}\n` +
      `Dagens HP-ord #${n}: ${word} 🤔 Vad betyder det? Svara i kommentarerna, svaret kommer i nästa bild. ` +
      `#högskoleprovet #hp #ordförståelse #plugga #studietips\n`,
    );
    console.log(`#${n} ${word}`);
  }
  fs.writeFileSync(path.join(OUT, "captions.txt"), captions.join("\n"));
  console.log(`\n${(TO - FROM + 1) * 2} images and captions.txt in ${OUT}`);
} finally {
  try { ws?.close(); } catch { /* already closed */ }
  browser.kill();
  server.close();
  await wait(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* the browser may still hold a file for a moment */ }
}

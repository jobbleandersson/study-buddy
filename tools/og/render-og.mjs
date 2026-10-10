// Renders the link-preview images (Open Graph, 1200×630) from og.html next to this file:
//   assets/og-pluggera.jpg  the front page (index.html, and the /ova practice pages)
//   assets/og-hp.jpg        pluggera.se/hp (server/src/routes/share-pages.js)
//
//   node tools/og/render-og.mjs
//
// JPEG, not PNG: WhatsApp drops a preview image much over 300 KB, and this one is a photo-like
// gradient. Keep the file names new when the picture changes a lot: Facebook, Discord and others
// cache a preview by its URL for weeks. No npm packages: it drives an installed Chrome, Edge or
// Chromium over the DevTools protocol (BROWSER=/path/to/it if it isn't found).

import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const IMAGES = [["home", "og-pluggera.jpg"], ["hp", "og-hp.jpg"]];
const MAX_BYTES = 300_000;

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

// A static server for the repo, so the page can load the fonts and the logo.
const TYPES = { ".html": "text/html", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
const port = await new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)));

const debug = await freePort();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "og-"));
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
  await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });

  for (const [variant, name] of IMAGES) {
    await send("Page.navigate", { url: `http://127.0.0.1:${port}/tools/og/og.html?v=${variant}` });
    let ready = false;
    for (let k = 0; k < 80 && !ready; k++) { await wait(100); ready = await evaluate(`document.body?.dataset.ready === "1"`).catch(() => false); }
    if (!ready) throw new Error(`The page never finished drawing "${variant}".`);
    // The words must clear the picture of the app, and nothing may run off the bottom.
    const fit = await evaluate(`(() => {
      const chips = document.querySelector(".chips"), lede = document.querySelector(".lede").getBoundingClientRect();
      const wide = [...document.querySelectorAll(".copy > *")].some((e) => e.scrollWidth > e.clientWidth + 1);
      return { tooTall: lede.bottom > chips.getBoundingClientRect().top - 16 || chips.scrollHeight > 60, tooWide: wide };
    })()`);
    if (fit.tooTall || fit.tooWide) console.warn(`  ! ${variant}: the text doesn't fit its column — shorten it`);
    const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 88, clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 } });
    const bytes = Buffer.from(shot.data, "base64");
    fs.writeFileSync(path.join(ROOT, "assets", name), bytes);
    console.log(`assets/${name}  ${Math.round(bytes.length / 1024)} KB${bytes.length > MAX_BYTES ? "  ! over 300 KB: WhatsApp may not show it" : ""}`);
  }
} finally {
  try { ws?.close(); } catch { /* already closed */ }
  browser.kill();
  server.close();
  await wait(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* the browser may still hold a file for a moment */ }
}

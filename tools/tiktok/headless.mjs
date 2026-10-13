// A headless Chrome, Edge or Chromium driven over the DevTools protocol, with a static server for the
// repo so pages can load the fonts, KaTeX, the logo and the question banks. Shared by the render-*.mjs
// scripts next to this file. No npm packages; set BROWSER=/path/to/the/browser if it isn't found.

import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

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

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg" };

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

/** Starts the server and the browser at width×height (CSS px; `scale` device pixels per px, `mobile`
 *  for a touch phone). `api(path)` may answer requests to /api/<path> with a JSON body (a local
 *  stand-in for the app's server; anything it returns nothing for is a 404). Returns
 *  { base, send, evaluate, open, shoot, close }: base is the server's URL, open(url) loads a page,
 *  evaluate(expr) runs an expression in it (awaiting promises) and returns its value. Always close()
 *  it, or the browser stays running. */
export async function launch({ width = 1080, height = 1920, scale = 1, mobile = false, api = null } = {}) {
  const browserPath = BROWSERS.find((b) => fs.existsSync(b));
  if (!browserPath) throw new Error("No Chrome, Edge or Chromium found. Run again with BROWSER=/path/to/the/browser.");

  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://x").pathname;
    if (api && pathname.startsWith("/api/")) {
      req.resume();
      const body = api(pathname.slice(5).replace(/\/$/, ""));
      res.writeHead(body ? 200 : 404, { "content-type": "application/json" });
      return res.end(JSON.stringify(body ?? {}));
    }
    let file = path.join(ROOT, decodeURIComponent(pathname));
    if (file.startsWith(ROOT) && fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  const port = await new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)));

  const debug = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "pluggera-tiktok-"));
  const browser = spawn(browserPath, [
    "--headless=new", `--remote-debugging-port=${debug}`, `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--force-color-profile=srgb", "about:blank",
  ], { stdio: "ignore" });

  let ws;
  const close = async () => {
    try { ws?.close(); } catch { /* already closed */ }
    browser.kill();
    if (process.platform === "win32") { try { spawn("taskkill", ["/PID", String(browser.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ } }
    server.close();
    await wait(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* the browser may still hold a file for a moment */ }
  };

  try {
    let target = null;
    for (let k = 0; k < 80 && !target; k++) {
      await wait(250);
      try { target = (await (await fetch(`http://127.0.0.1:${debug}/json/list`)).json()).find((t) => t.type === "page"); } catch { /* not up yet */ }
    }
    if (!target) throw new Error(`The browser didn't start: ${browserPath}`);
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
  } catch (e) {
    await close();
    throw e;
  }

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
  const evaluate = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  /** Loads a page and waits until `ready` (an expression) is true. */
  const open = async (url, ready = "document.readyState === 'complete'") => {
    await send("Page.navigate", { url });
    for (let k = 0; k < 100; k++) {
      await wait(100);
      if (await evaluate(ready).catch(() => false)) return;
    }
    throw new Error(`The page never got ready: ${url}`);
  };
  const shoot = async (format = "jpeg", quality = 94) =>
    (await send("Page.captureScreenshot", { format, ...(format === "jpeg" ? { quality } : {}), clip: { x: 0, y: 0, width, height, scale: 1 } })).data;

  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile, screenWidth: width, screenHeight: height });
  if (mobile) await send("Emulation.setTouchEmulationEnabled", { enabled: true });
  return { base: `http://127.0.0.1:${port}`, send, evaluate, open, shoot, close };
}

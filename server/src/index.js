import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import "./db.js"; // creates tables on first run
import { startSweeper } from "./sweep.js";
import { health } from "./routes/health.js";
import { messages } from "./routes/messages.js";
import { auth } from "./routes/auth.js";
import { state } from "./routes/state.js";
import { links } from "./routes/links.js";
import { assigned } from "./routes/assigned.js";
import { parent } from "./routes/parent.js";
import { friends } from "./routes/friends.js";
import { classes } from "./routes/classes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The frontend (index.html, css/, js/, etc.) is the repo root — normally two
// levels up from server/src/. Hosts lay the checkout out in different ways, so
// probe a few candidates for the one that actually has index.html rather than
// trusting a single relative path. FRONTEND_ROOT overrides the search.
function findFrontendRoot() {
  const candidates = [
    process.env.FRONTEND_ROOT,
    path.join(__dirname, "..", ".."),
    path.join(process.cwd(), ".."),
    process.cwd(),
    path.join(__dirname, ".."),
  ].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "index.html"))) return dir;
  }
  return candidates[1]; // fall back to the conventional location
}
const FRONTEND_ROOT = findFrontendRoot();
const INDEX_HTML = path.join(FRONTEND_ROOT, "index.html");
console.log(`[study-buddy-server] frontend root: ${FRONTEND_ROOT} (index.html ${fs.existsSync(INDEX_HTML) ? "found" : "MISSING"})`);

const PORT = process.env.PORT || 8787;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN; // unset = same-origin only, which is now the default deployment shape

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn("[study-buddy-server] ANTHROPIC_API_KEY is not set — /api/messages will fail until it is.");
}
if (process.env.COOKIE_SECURE !== "true") {
  console.warn("[study-buddy-server] COOKIE_SECURE is not 'true' — session cookies are not marked Secure. Fine over http on localhost; set COOKIE_SECURE=true once this is served over https.");
}

const app = express();

// Behind a hosting platform's load balancer (Render, Railway, Fly, …) the real
// client protocol and IP arrive in X-Forwarded-* headers. Trusting one proxy
// hop lets `secure` session cookies and the per-IP rate limiter work correctly.
// Harmless locally (there is no proxy, so nothing is forwarded).
app.set("trust proxy", 1);

// Optional shared-password gate for private testing. Set SITE_PASSWORD in the
// host's env to switch it on; unset (the default) leaves the site open. The
// /api/* paths are exempt so Stripe webhooks and the app's own API — which have
// their own auth — keep working; the browser handles the popup and caching.
if (process.env.SITE_PASSWORD) {
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    const header = req.headers.authorization || "";
    const [, encoded] = header.split(" ");
    const [, pass] = Buffer.from(encoded || "", "base64").toString().split(":");
    if (pass === process.env.SITE_PASSWORD) return next();
    // Header VALUES must be Latin-1/ASCII — an em dash here throws
    // ERR_INVALID_CHAR at the http layer and 500s every unauthenticated
    // request, which is worse than the gate being slightly plainer-worded.
    res.set("WWW-Authenticate", 'Basic realm="Studify - private testing"');
    return res.status(401).send("Authentication required.");
  });
}

if (ALLOWED_ORIGIN) app.use(cors({ origin: ALLOWED_ORIGIN, credentials: true })); // only needed if the frontend is ever hosted separately from this server
app.use(cookieParser());
app.use(express.json({ limit: "10mb" })); // material.js caps uploaded images at 5MB, base64 inflates that ~33%

app.use("/api", health);
app.use("/api", messages);
app.use("/api", auth);
app.use("/api", state);
app.use("/api", links);
app.use("/api", assigned);
app.use("/api", parent);
app.use("/api", friends);
app.use("/api", classes);

// Never let the static server reach into server/ itself — it holds .env,
// the sqlite db, and node_modules, none of which are meant to be fetchable.
app.use((req, res, next) => (req.path === "/server" || req.path.startsWith("/server/")) ? res.status(404).end() : next());
app.use(express.static(FRONTEND_ROOT, { dotfiles: "ignore" }));

// Single-page app: any unmatched GET falls back to index.html so deep links
// (the client uses hash routing, but a bare "/" and any stray path) resolve.
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(INDEX_HTML, (err) => { if (err) next(err); });
});

// Turn a swallowed 500 into a logged stack trace — otherwise Render just shows
// "Internal Server Error" with nothing to go on. The app reads API errors as
// {error:{message}}, so /api gets that shape; everything else gets plain text.
app.use((err, req, res, next) => {
  console.error(`[study-buddy-server] error on ${req.method} ${req.originalUrl}:`, err);
  if (res.headersSent) return next(err);
  if (req.originalUrl.startsWith("/api/")) {
    return res.status(500).json({ error: { message: "Something went wrong.", code: "server_error" } });
  }
  res.status(500).send("Internal Server Error");
});

// Last line of defence: a promise rejection nobody handled (a timer, a fire-
// and-forget fetch) would otherwise exit the process on Node 15+ and take the
// site down with it. Log it and keep serving. Route handlers don't rely on
// this — async ones go through asyncHandler. Uncaught *exceptions* are left
// alone on purpose: after one, the process state can't be trusted, so let it
// exit and the host restart it.
process.on("unhandledRejection", (reason) => {
  console.error("[study-buddy-server] unhandled rejection (still running):", reason);
});

try {
  startSweeper(); // prune expired sessions + used/old codes, hourly
} catch (e) {
  console.error("[study-buddy-server] sweeper failed to start:", e);
}

app.listen(PORT, () => {
  console.log(`[study-buddy-server] listening on http://localhost:${PORT} (NODE_ENV=${process.env.NODE_ENV || "unset"})`);
});

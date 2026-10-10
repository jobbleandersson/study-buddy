import "dotenv/config";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { compress } from "./compress.js";
import { staticCacheControl } from "./static-cache.js";
import "./db.js"; // creates tables on first run
import { startSweeper } from "./sweep.js";
import { requireGate, gate } from "./gate.js";
import { health } from "./routes/health.js";
import { messages } from "./routes/messages.js";
import { auth } from "./routes/auth.js";
import { state } from "./routes/state.js";
import { links } from "./routes/links.js";
import { assigned } from "./routes/assigned.js";
import { parent } from "./routes/parent.js";
import { friends } from "./routes/friends.js";
import { classes } from "./routes/classes.js";
import { classDaily } from "./routes/class-daily.js";
import { account } from "./routes/account.js";
import { waitlist } from "./routes/waitlist.js";
import { contact } from "./routes/contact.js";
import { analytics } from "./routes/analytics.js";
import { clientErrors } from "./routes/client-errors.js";
import { startAiWatch } from "./ai-check.js";
import { reviews } from "./routes/reviews.js";
import { practicePages } from "./routes/practice-pages.js";
import { sharePages } from "./routes/share-pages.js";

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

// CSP hashes for index.html's inline <script>s, taken from the file itself at startup. The
// redirect script there has to stay inline (it runs before <base href="/">, which would break any
// relative src on GitHub Pages), and a hash pasted in here by hand would silently stop matching —
// and get the script blocked — the first time anyone edited it.
const INLINE_SCRIPT_HASHES = (() => {
  try {
    const html = fs.readFileSync(INDEX_HTML, "utf8");
    return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
      .map((m) => `'sha256-${crypto.createHash("sha256").update(m[1]).digest("base64")}'`);
  } catch {
    return [];
  }
})();

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
// client protocol arrives in X-Forwarded-* headers; trusting one proxy hop makes
// req.protocol / req.secure right. It does NOT give the client's IP on Fly — there
// the last X-Forwarded-For entry is the app's own address — so the throttles use
// clientIp() in middleware/attemptLimit.js, which reads Fly-Client-IP.
// Harmless locally (there is no proxy, so nothing is forwarded).
app.set("trust proxy", 1);

// Security headers on every response, including the ones above (a 401 from the password gate
// deserves them too). Hand-written rather than a dependency like helmet, so each choice below is
// visible in one place.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  // Kept out of search results until PUBLIC_INDEXING=true — on every response, not just the HTML
  // pages, so the app shell, JSON and images can't be listed either.
  if (process.env.PUBLIC_INDEXING !== "true") res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // Only meaningful once the connection really is HTTPS — same signal the session cookie's
  // `secure` flag already uses, just above.
  if (process.env.COOKIE_SECURE === "true") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    // 'unsafe-eval': vendor/pdf.min.js and its worker (vendor/pdf.worker.min.js) call
    // new Function()/eval() internally — importing a PDF breaks without it. The Google origin is
    // for "Sign in with Google": its script and the sign-in iframe it opens. index.html's inline
    // scripts are allowed by hash (INLINE_SCRIPT_HASHES above), never by 'unsafe-inline'.
    ["script-src 'self' 'unsafe-eval' https://accounts.google.com", ...INLINE_SCRIPT_HASHES].join(" "),
    // 'unsafe-inline': a few places build an inline style="" attribute into an HTML string
    // (e.g. js/components/questions.js) rather than setting it through the DOM. The one outside
    // stylesheet is Google's own for its sign-in button (dormant until GOOGLE_CLIENT_ID is set) -
    // the script injects a <link> to it, and without this the button renders unstyled.
    "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' https://accounts.google.com",
    "frame-src https://accounts.google.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join("; "));
  next();
});

// Once the site has its own domain, every other hostname it answers on (the .fly.dev address,
// www.) permanently redirects there, so there is one copy of each page for search engines and one
// origin for cookies/localStorage. Only page loads move: /api/* stays reachable on the old host so a
// tab left open there keeps working until it's reloaded. Browsers carry the #/route fragment across
// the redirect, so deep links survive. Unset (the default, and in local dev) = no redirect.
const CANONICAL_HOST = process.env.CANONICAL_HOST;
if (CANONICAL_HOST) {
  app.use((req, res, next) => {
    if ((req.method !== "GET" && req.method !== "HEAD") || req.path.startsWith("/api/")) return next();
    if (req.get("host") === CANONICAL_HOST) return next();
    res.redirect(301, `https://${CANONICAL_HOST}${req.originalUrl}`);
  });
}


if (ALLOWED_ORIGIN) app.use(cors({ origin: ALLOWED_ORIGIN, credentials: true })); // only needed if the frontend is ever hosted separately from this server
app.use(compress);   // gzip/brotli for text responses; see compress.js
app.use(cookieParser());
// Private site (see gate.js): before the body parsers, so a visitor without the password cannot make the
// server read a 10MB JSON body either. Open (a no-op) when SITE_PASSWORD is unset.
app.use("/api", requireGate);
// Only these carry whole documents: a tutor message with photos (material.js caps an image at 5MB,
// base64 inflates that ~33%), a full study-state sync, a set a parent assigns. Everything else is
// a few fields, so it gets a small cap — an anonymous request to, say, the waitlist can't make the
// server parse 10MB of JSON.
const LARGE_JSON_ROUTES = /^\/api\/(messages|state|assigned)\/?$/i;   // routing ignores case and a trailing slash, so this must too
const jsonLarge = express.json({ limit: "10mb" });
const jsonSmall = express.json({ limit: "100kb" });
app.use((req, res, next) => (LARGE_JSON_ROUTES.test(req.path) ? jsonLarge : jsonSmall)(req, res, next));

app.use("/api", gate);
app.use("/api", health);
app.use("/api", messages);
app.use("/api", auth);
app.use("/api", state);
app.use("/api", links);
app.use("/api", assigned);
app.use("/api", parent);
app.use("/api", friends);
app.use("/api", classes);
app.use("/api", classDaily);
app.use("/api", account);
app.use("/api", waitlist);
app.use("/api", contact);
app.use("/api", analytics);
app.use("/api", clientErrors);
app.use("/api", reviews);
// An /api path no router claimed: answer in the API's own shape, not Express's HTML "Cannot GET".
// (The static stand-in api/health, for hosts with no server, is never reached here — the health
// router above answers that path first.)
app.use("/api", (req, res) => res.status(404).json({ error: { message: "Not found.", code: "not_found" } }));

// Never let the static server reach into server/ itself — it holds .env,
// the sqlite db, and node_modules, none of which are meant to be fetchable.
// The check runs on the DECODED, slash-collapsed, lower-cased path: express.static decodes the URL
// itself, so a raw-path comparison was bypassed by "/%73erver/...", "//server/..." and (on
// case-insensitive disks) "/SERVER/...". Deploy files are blocked too.
const BLOCKED = /^\/(server|deploy)(\/|$)|^\/(dockerfile|fly\.toml|\.dockerignore)$/;
app.use((req, res, next) => {
  let p;
  try { p = decodeURIComponent(req.path); } catch { return res.status(400).end(); }
  p = p.replace(/\/{2,}/g, "/").toLowerCase();
  return BLOCKED.test(p) ? res.status(404).end() : next();
});
// Public practice pages (/ova/...), robots.txt and sitemap.xml — server-rendered so search engines
// can read them. See routes/practice-pages.js.
app.use(practicePages);
// Addresses of their own (pluggera.se/hp) for the screens worth sharing: the app with that screen's
// preview image and title. See routes/share-pages.js.
app.use(sharePages(INDEX_HTML));

// Long-lived caching only for files that never change under the same name; see static-cache.js.
app.use(express.static(FRONTEND_ROOT, {
  dotfiles: "ignore",
  setHeaders(res, filePath) {
    const cc = staticCacheControl(filePath);
    if (cc) res.setHeader("Cache-Control", cc);
  },
}));

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
  // The client's fault, not ours: malformed JSON (400), a body over the size cap (413). Answer with
  // that status instead of a 500, and skip the stack trace, so anyone posting junk can't fill the
  // log with fake "server errors". Only express.json's own errors (they carry a `type`, e.g.
  // "entity.parse.failed") — other 4xx-tagged errors, like sendFile failing on a missing
  // index.html, are real server problems and still get logged as 500s below.
  const status = err.status || err.statusCode;
  if (typeof err.type === "string" && status >= 400 && status < 500 && !res.headersSent) {
    const message = status === 413 ? "That request is too large." : "The request couldn't be read.";
    if (req.originalUrl.startsWith("/api/")) return res.status(status).json({ error: { message, code: "bad_request" } });
    return res.status(status).send(message);
  }
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

startAiWatch();   // mails ALERT_EMAIL if the AI stops answering (ai-check.js)

app.listen(PORT, () => {
  console.log(`[study-buddy-server] listening on http://localhost:${PORT} (NODE_ENV=${process.env.NODE_ENV || "unset"})`);
});

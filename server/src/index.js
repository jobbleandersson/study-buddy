import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import "./db.js"; // creates tables on first run
import { health } from "./routes/health.js";
import { messages } from "./routes/messages.js";
import { auth } from "./routes/auth.js";
import { state } from "./routes/state.js";
import { links } from "./routes/links.js";
import { assigned } from "./routes/assigned.js";
import { parent } from "./routes/parent.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The frontend (index.html, css/, js/, etc.) lives two levels up from
// server/src/ — this is the repo root, served alongside the API so the
// whole app is one origin and one process.
const FRONTEND_ROOT = path.join(__dirname, "..", "..");

const PORT = process.env.PORT || 8787;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN; // unset = same-origin only, which is now the default deployment shape

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn("[study-buddy-server] ANTHROPIC_API_KEY is not set — /api/messages will fail until it is.");
}
if (process.env.COOKIE_SECURE !== "true") {
  console.warn("[study-buddy-server] COOKIE_SECURE is not 'true' — session cookies are not marked Secure. Fine over http on localhost; set COOKIE_SECURE=true once this is served over https.");
}

const app = express();
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

// Never let the static server reach into server/ itself — it holds .env,
// the sqlite db, and node_modules, none of which are meant to be fetchable.
app.use((req, res, next) => (req.path === "/server" || req.path.startsWith("/server/")) ? res.status(404).end() : next());
app.use(express.static(FRONTEND_ROOT, { dotfiles: "ignore" }));

app.listen(PORT, () => {
  console.log(`[study-buddy-server] listening on http://localhost:${PORT}`);
});

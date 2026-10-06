import { Router } from "express";
import crypto from "node:crypto";
import { db } from "../db.js";
import { clientErrorLimit } from "../middleware/authLimits.js";
import { adminFailures, requireAdminKey } from "../middleware/adminKey.js";

export const clientErrors = Router();

// Script errors from students' browsers, so a bug that only shows on someone's phone is seen at all.
//   POST   /api/client-errors            one report, from js/lib/error-report.js (sendBeacon)
//   GET    /api/admin/client-errors      the list, for whoever holds the admin key (#/admin/errors)
//   DELETE /api/admin/client-errors/:id  mark one as fixed; if it happens again it comes back
//
// Anonymous like the pageview ping: no user id, no IP, no cookie. The browser already strips the page
// address of anything personal (query strings, ids); the server trims and caps every field again.
// One row per distinct error (kind + message + source), counted, so a bug on a busy page is one line.

const KINDS = new Set(["error", "rejection", "resource"]);
const MAX_ROWS = 500;

const clip = (v, max) => {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return s ? s.slice(0, max) : null;
};
// The page, without a query string (it can carry a token) - the browser does this too.
const cleanRoute = (v) => clip(typeof v === "string" ? v.split("?")[0] : "", 100);

clientErrors.post("/client-errors", clientErrorLimit, (req, res) => {
  const b = req.body || {};
  const kind = KINDS.has(b.kind) ? b.kind : null;
  const message = clip(b.message, 300);
  if (!kind || !message) return res.status(400).json({ error: { message: "Bad report.", code: "bad_report" } });
  const source = clip(b.source, 200);
  const stack = typeof b.stack === "string" ? b.stack.slice(0, 1500) : null;
  const id = crypto.createHash("sha256").update(`${kind}|${message}|${source || ""}`).digest("hex").slice(0, 24);
  const now = Date.now();
  db.prepare(`
    INSERT INTO client_errors (id, kind, message, source, stack, route, app_version, browser, count, first_at, last_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      count = count + 1, last_at = excluded.last_at, stack = COALESCE(excluded.stack, stack),
      route = excluded.route, app_version = excluded.app_version, browser = excluded.browser
  `).run(id, kind, message, source, stack, cleanRoute(b.route), clip(b.version, 40), clip(b.browser, 60), now, now);
  // Keep the table to the most recently seen MAX_ROWS (a count over a few hundred rows, so cheap).
  if (db.prepare("SELECT COUNT(*) AS n FROM client_errors").get().n > MAX_ROWS) {
    db.prepare("DELETE FROM client_errors WHERE id NOT IN (SELECT id FROM client_errors ORDER BY last_at DESC LIMIT ?)").run(MAX_ROWS);
  }
  res.status(204).end();
});

clientErrors.get("/admin/client-errors", adminFailures, requireAdminKey, (req, res) => {
  const rows = db.prepare("SELECT * FROM client_errors ORDER BY last_at DESC LIMIT 200").all();
  const totals = db.prepare("SELECT COUNT(*) AS kinds, COALESCE(SUM(count), 0) AS reports FROM client_errors").get();
  res.set("Cache-Control", "no-store");
  res.json({
    totals,
    errors: rows.map((r) => ({
      id: r.id, kind: r.kind, message: r.message, source: r.source, stack: r.stack, route: r.route,
      version: r.app_version, browser: r.browser, count: r.count, firstAt: r.first_at, lastAt: r.last_at,
    })),
  });
});

clientErrors.delete("/admin/client-errors/:id", adminFailures, requireAdminKey, (req, res) => {
  const { changes } = db.prepare("DELETE FROM client_errors WHERE id = ?").run(String(req.params.id));
  if (!changes) return res.status(404).json({ error: { message: "Not found." } });
  res.json({ ok: true });
});

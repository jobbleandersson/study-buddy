import { Router } from "express";
import crypto from "node:crypto";
import { db } from "../db.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { pageviewLimit } from "../middleware/authLimits.js";

export const analytics = Router();

const clip = (v, max) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
};

// Fed by trackEntryPageview() in js/main.js — one ping per app load, not per
// in-app route change. Anonymous by design: no user id, no IP stored, no
// cookie, so this never needs a cookie-consent banner.
analytics.post("/analytics/pageview", pageviewLimit, asyncHandler(async (req, res) => {
  const b = req.body || {};
  db.prepare(`
    INSERT INTO page_views (id, path, referrer, utm_source, utm_medium, utm_campaign, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    clip(b.path, 200) || "/",
    clip(b.referrer, 300),
    clip(b.utm_source, 100),
    clip(b.utm_medium, 100),
    clip(b.utm_campaign, 100),
    Date.now(),
  );
  res.status(204).end();
}));

// No admin/role system exists yet, so this read side is gated by a shared
// secret (ANALYTICS_KEY) the same way SITE_PASSWORD gates the whole site in
// index.js, rather than building real admin auth for one report. A header,
// not a "?key=" query string: a query string ends up in Fly's own request
// logs, any proxy's access log, and browser history the moment someone opens
// the URL by hand — exactly what SITE_PASSWORD's use of Basic Auth already
// avoids. Unset key = disabled entirely (404, not 401 — doesn't even confirm
// the route exists).
analytics.get("/analytics/summary", (req, res) => {
  const wanted = process.env.ANALYTICS_KEY;
  if (!wanted) return res.status(404).end();
  const given = Buffer.from(String(req.headers["x-analytics-key"] || ""));
  const want = Buffer.from(wanted);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return res.status(404).end();

  const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const byDay = db.prepare(`
    SELECT date(created_at / 1000, 'unixepoch') AS day, COUNT(*) AS n
    FROM page_views WHERE created_at >= ? GROUP BY day ORDER BY day DESC
  `).all(since);
  const bySource = db.prepare(`
    SELECT COALESCE(NULLIF(utm_source, ''), '(direct/none)') AS source, COUNT(*) AS n
    FROM page_views WHERE created_at >= ? GROUP BY source ORDER BY n DESC LIMIT 20
  `).all(since);
  const byCampaign = db.prepare(`
    SELECT utm_source AS source, utm_medium AS medium, utm_campaign AS campaign, COUNT(*) AS n
    FROM page_views WHERE created_at >= ? AND utm_campaign IS NOT NULL
    GROUP BY utm_source, utm_medium, utm_campaign ORDER BY n DESC LIMIT 20
  `).all(since);
  const byPath = db.prepare(`
    SELECT path, COUNT(*) AS n FROM page_views WHERE created_at >= ? GROUP BY path ORDER BY n DESC LIMIT 20
  `).all(since);
  const byReferrer = db.prepare(`
    SELECT COALESCE(NULLIF(referrer, ''), '(none)') AS referrer, COUNT(*) AS n
    FROM page_views WHERE created_at >= ? GROUP BY referrer ORDER BY n DESC LIMIT 20
  `).all(since);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM page_views WHERE created_at >= ?`).get(since).n;

  res.json({ sinceDays: 30, total, byDay, bySource, byCampaign, byPath, byReferrer });
});

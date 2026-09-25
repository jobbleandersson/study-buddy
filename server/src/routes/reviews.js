import { Router } from "express";
import crypto from "node:crypto";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { attemptLimit } from "../middleware/attemptLimit.js";

export const reviews = Router();

// Reviews of Studify, written by signed-in students in the app (#/rate) and shown on the front page
// only once approved. The flow:
//   POST   /api/reviews             a student sends (or replaces) their one review -> 'pending'
//   GET    /api/reviews/mine        their own review and its status, so the form can show it
//   DELETE /api/reviews/mine        they take it back, approved or not
//   GET    /api/reviews             public: approved reviews only, never an email or user id
//   GET    /api/admin/reviews       the queue, for whoever holds REVIEW_ADMIN_KEY
//   POST   /api/admin/reviews/:id   approve or reject one
//   DELETE /api/admin/reviews/:id   remove one entirely
//
// Moderation is a shared key rather than an account role: there are no roles in this schema (see the
// comment on "links" in db.js), and an email allowlist would hand the role to whoever registers that
// address first while email verification is off. Set it with `fly secrets set REVIEW_ADMIN_KEY=...`;
// unset, the admin endpoints answer 404 as if they didn't exist.

export const LIMITS = { textMin: 10, textMax: 600, nameMax: 30, contextMax: 60 };
const LANGS = new Set(["sv", "en"]);
const PUBLIC_MAX = 50;

// A person sends a handful of edits at most; this only stops a script from churning the queue.
const submitLimit = attemptLimit({
  name: "review-submit", max: Number(process.env.REVIEW_SUBMITS_PER_HOUR_PER_USER ?? 10), windowMs: 60 * 60_000,
  key: (req) => req.user?.userId,
});
// Only wrong keys count, per address: 10 guesses per 15 minutes.
const adminFailures = attemptLimit({
  name: "review-admin-fail", max: Number(process.env.REVIEW_ADMIN_FAILS_PER_15MIN_PER_IP ?? 10), windowMs: 15 * 60_000,
  failureStatuses: [403],
});

const clean = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max + 1);

/** The review as the student sees their own, or as the public list shows it. */
function publicShape(r) {
  return {
    name: r.display_name,
    context: r.context || "",
    text: r.text,
    lang: r.lang,
    rating: r.rating,
    date: new Date(r.created_at).toISOString().slice(0, 10),
  };
}

reviews.get("/reviews", (req, res) => {
  const rows = db.prepare(
    "SELECT * FROM reviews WHERE status = 'approved' AND consent = 1 ORDER BY created_at DESC LIMIT ?"
  ).all(PUBLIC_MAX);
  res.set("Cache-Control", "no-store");
  res.json({ reviews: rows.map(publicShape) });
});

reviews.get("/reviews/mine", requireAuth, (req, res) => {
  const row = db.prepare("SELECT * FROM reviews WHERE user_id = ?").get(req.user.userId);
  res.json({ review: row ? { ...publicShape(row), status: row.status } : null });
});

reviews.post("/reviews", requireAuth, submitLimit, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const rating = Number(b.rating);
  const text = clean(b.text, LIMITS.textMax);
  const name = clean(b.name, LIMITS.nameMax);
  const context = clean(b.context, LIMITS.contextMax);
  const lang = LANGS.has(b.lang) ? b.lang : null;

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: { message: "Pick 1 to 5 stars.", code: "review_rating" } });
  }
  if (text.length < LIMITS.textMin || text.length > LIMITS.textMax) {
    return res.status(400).json({ error: { message: "Write between 10 and 600 characters.", code: "review_text" } });
  }
  // First name or initials: a short name, no address or handle. The moderator is the real check.
  if (!name || name.length > LIMITS.nameMax || /[@\d]/.test(name)) {
    return res.status(400).json({ error: { message: "Enter a first name or initials.", code: "review_name" } });
  }
  if (context.length > LIMITS.contextMax) {
    return res.status(400).json({ error: { message: "Keep the description under 60 characters.", code: "review_context" } });
  }
  if (!lang) return res.status(400).json({ error: { message: "Unknown language.", code: "review_lang" } });
  if (b.consent !== true) {
    return res.status(400).json({ error: { message: "Tick the box to let us show your review.", code: "review_consent" } });
  }

  const now = Date.now();
  db.prepare(`
    INSERT INTO reviews (id, user_id, rating, text, display_name, context, lang, consent, status, created_at, reviewed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'pending', ?, NULL)
    ON CONFLICT(user_id) DO UPDATE SET
      rating = excluded.rating, text = excluded.text, display_name = excluded.display_name,
      context = excluded.context, lang = excluded.lang, consent = 1,
      status = 'pending', created_at = excluded.created_at, reviewed_at = NULL
  `).run(crypto.randomUUID(), req.user.userId, rating, text, name, context, lang, now);
  res.json({ ok: true, status: "pending" });
}));

reviews.delete("/reviews/mine", requireAuth, (req, res) => {
  db.prepare("DELETE FROM reviews WHERE user_id = ?").run(req.user.userId);
  res.json({ ok: true });
});

/* ---------------- moderation ---------------- */

function requireAdminKey(req, res, next) {
  const wanted = process.env.REVIEW_ADMIN_KEY || "";
  if (!wanted) return res.status(404).json({ error: { message: "Not found." } });
  const given = Buffer.from(String(req.headers["x-admin-key"] || ""));
  const want = Buffer.from(wanted);
  if (given.length === want.length && crypto.timingSafeEqual(given, want)) return next();
  return res.status(403).json({ error: { message: "Wrong admin key.", code: "admin_key" } });
}

reviews.get("/admin/reviews", adminFailures, requireAdminKey, (req, res) => {
  const status = ["pending", "approved", "rejected"].includes(req.query.status) ? req.query.status : "pending";
  const rows = db.prepare("SELECT * FROM reviews WHERE status = ? ORDER BY created_at DESC LIMIT 200").all(status);
  const counts = Object.fromEntries(
    db.prepare("SELECT status, COUNT(*) AS n FROM reviews GROUP BY status").all().map((r) => [r.status, r.n])
  );
  res.set("Cache-Control", "no-store");
  res.json({
    counts: { pending: counts.pending || 0, approved: counts.approved || 0, rejected: counts.rejected || 0 },
    // The moderator sees what the public would, plus the id to act on. Still no email or user id.
    reviews: rows.map((r) => ({ id: r.id, status: r.status, ...publicShape(r) })),
  });
});

reviews.post("/admin/reviews/:id", adminFailures, requireAdminKey, (req, res) => {
  const status = req.body?.status;
  if (status !== "approved" && status !== "rejected") {
    return res.status(400).json({ error: { message: "Status must be approved or rejected." } });
  }
  const info = db.prepare("UPDATE reviews SET status = ?, reviewed_at = ? WHERE id = ?")
    .run(status, Date.now(), String(req.params.id));
  if (!info.changes) return res.status(404).json({ error: { message: "Not found." } });
  res.json({ ok: true });
});

reviews.delete("/admin/reviews/:id", adminFailures, requireAdminKey, (req, res) => {
  const info = db.prepare("DELETE FROM reviews WHERE id = ?").run(String(req.params.id));
  if (!info.changes) return res.status(404).json({ error: { message: "Not found." } });
  res.json({ ok: true });
});

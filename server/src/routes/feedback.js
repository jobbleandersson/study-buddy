import { Router } from "express";
import crypto from "node:crypto";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { attemptLimit } from "../middleware/attemptLimit.js";
import { adminFailures, requireAdminKey } from "../middleware/adminKey.js";

export const feedback = Router();

// What students tell us about the site: ideas, problems, praise, a quick mood tap. In the first months this
// is how we find out what to build and fix, so it has to be easy to send and impossible to lose. The flow
// mirrors reviews.js and ai-reports.js:
//   POST   /api/feedback              a signed-in student sends one -> 'new'
//   GET    /api/feedback/mine         their own, with the status and our reply, for "Dina förslag"
//   DELETE /api/feedback/mine/:id     they take one back
//   GET    /api/admin/feedback        the inbox (#/admin/feedback), for whoever holds REVIEW_ADMIN_KEY
//   POST   /api/admin/feedback/:id    set a status and/or write a reply the sender will see
//   DELETE /api/admin/feedback/:id    remove one
//
// A student can send "without my account" (anonymous: true): the row then has no user_id, so it can be read
// but not answered, and it is not in /mine. The moderator never sees an email or a user id either way, only
// whether the sender can be answered (`linked`). Nothing here is shown to other students.

export const FEEDBACK_LIMITS = { messageMax: 2000, messageMin: 3, replyMax: 500 };
const KINDS = new Set(["idea", "problem", "praise", "other"]);
const CONTEXTS = new Set(["button", "page", "after-session", "after-results"]);
const STATUSES = ["new", "seen", "planned", "done", "declined"];
const LANGS = new Set(["sv", "en"]);

// A few messages an hour is a lot for one person; this only stops a script from filling the inbox.
const submitLimit = attemptLimit({
  name: "feedback-submit", max: Number(process.env.FEEDBACK_PER_HOUR_PER_USER ?? 10), windowMs: 60 * 60_000,
  key: (req) => req.user?.userId,
});
const submitDaily = attemptLimit({
  name: "feedback-submit-day", max: Number(process.env.FEEDBACK_PER_DAY_PER_USER ?? 30), windowMs: 24 * 60 * 60_000,
  key: (req) => req.user?.userId,
});

const clip = (v, max) => {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return s ? s.slice(0, max) : null;
};
// A message keeps its line breaks, but not runs of blank lines or trailing space.
const cleanMessage = (v) =>
  (typeof v === "string" ? v : "").replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, FEEDBACK_LIMITS.messageMax + 1);
// The page, without a query string (it can carry a token) - the browser does this too.
const cleanRoute = (v) => clip(typeof v === "string" ? v.split("?")[0] : "", 100);

const dateOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/** The row as the sender sees their own. */
function mineShape(r) {
  return {
    id: r.id, kind: r.kind, mood: r.mood, message: r.message, context: r.context,
    status: r.status, reply: r.reply, repliedAt: r.replied_at, date: dateOf(r.created_at),
  };
}

feedback.post("/feedback", requireAuth, submitLimit, submitDaily, (req, res) => {
  const b = req.body || {};
  if (!KINDS.has(b.kind)) return res.status(400).json({ error: { message: "Pick what this is about.", code: "feedback_kind" } });
  let mood = null;
  if (b.mood != null) {
    mood = b.mood;
    if (typeof mood !== "number" || !Number.isInteger(mood) || mood < 1 || mood > 5) {
      return res.status(400).json({ error: { message: "Mood is 1 to 5.", code: "feedback_mood" } });
    }
  }
  const message = cleanMessage(b.message);
  if (message.length > FEEDBACK_LIMITS.messageMax) {
    return res.status(400).json({ error: { message: "Keep it under 2000 characters.", code: "feedback_text" } });
  }
  // A quick mood tap needs no words; everything else needs something to read.
  if (message.length < FEEDBACK_LIMITS.messageMin && mood == null) {
    return res.status(400).json({ error: { message: "Write a few words, or tap a mood.", code: "feedback_text" } });
  }
  const context = CONTEXTS.has(b.context) ? b.context : "button";
  const lang = LANGS.has(b.lang) ? b.lang : null;
  const userId = b.anonymous === true ? null : req.user.userId;

  // A double tap on "Skicka" sends the same text twice within moments: keep the first. Only for a linked
  // sender; two anonymous messages with the same words ("Bra app!") may be two people.
  const now = Date.now();
  // An anonymous row gets the hour, not the millisecond: an exact time could be matched against the
  // sender's own request times to find out who "anonymous" was.
  const at = userId ? now : now - (now % 3_600_000);
  if (userId && message) {
    const twin = db.prepare("SELECT id FROM feedback WHERE user_id = ? AND kind = ? AND message = ? AND created_at > ?")
      .get(userId, b.kind, message, now - 10 * 60_000);
    if (twin) return res.json({ ok: true, id: twin.id });
  }

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO feedback (id, user_id, kind, mood, message, context, route, lang, app_version, browser, status, reply, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', '', ?, ?)
  `).run(id, userId, b.kind, mood, message, context, cleanRoute(b.route), lang, clip(b.version, 40), clip(b.browser, 60), at, at);
  res.json({ ok: true, id });
});

feedback.get("/feedback/mine", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT * FROM feedback WHERE user_id = ? ORDER BY rowid DESC LIMIT 50").all(req.user.userId);
  res.set("Cache-Control", "no-store");
  res.json({ feedback: rows.map(mineShape) });
});

feedback.delete("/feedback/mine/:id", requireAuth, (req, res) => {
  const info = db.prepare("DELETE FROM feedback WHERE id = ? AND user_id = ?").run(String(req.params.id), req.user.userId);
  if (!info.changes) return res.status(404).json({ error: { message: "Not found." } });
  res.json({ ok: true });
});

/* ---------------- the inbox ---------------- */

const adminShape = (r) => ({
  id: r.id, kind: r.kind, mood: r.mood, message: r.message, context: r.context, route: r.route, lang: r.lang,
  version: r.app_version, browser: r.browser, status: r.status, reply: r.reply, repliedAt: r.replied_at,
  linked: r.user_id != null, date: dateOf(r.created_at), cursor: r.cursor,
});
// Everything above is client-supplied text. The admin page and "Dina förslag" must show it as text nodes,
// never as HTML.

feedback.get("/admin/feedback", adminFailures, requireAdminKey, (req, res) => {
  const status = STATUSES.includes(req.query.status) ? req.query.status : null;
  const kind = KINDS.has(req.query.kind) ? req.query.kind : null;
  // Newest first by insertion order (an anonymous row's created_at is rounded to the hour, so it can't
  // order or page by time). `before` is the `cursor` of the last row of the previous page.
  const before = Number.isInteger(Number(req.query.before)) && req.query.before ? Number(req.query.before) : null;
  const rows = db.prepare(`
    SELECT rowid AS cursor, * FROM feedback WHERE (? IS NULL OR status = ?) AND (? IS NULL OR kind = ?) AND (? IS NULL OR rowid < ?)
    ORDER BY rowid DESC LIMIT 200
  `).all(status, status, kind, kind, before, before);
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const r of db.prepare("SELECT status, COUNT(*) AS n FROM feedback GROUP BY status").all()) counts[r.status] = r.n;
  const byKind = Object.fromEntries([...KINDS].map((k) => [k, 0]));
  for (const r of db.prepare("SELECT kind, COUNT(*) AS n FROM feedback GROUP BY kind").all()) byKind[r.kind] = r.n;
  // How people feel, over the last 30 days: the number to watch while the site is young.
  const since = Date.now() - 30 * 24 * 60 * 60_000;
  const moodRows = db.prepare("SELECT mood, COUNT(*) AS n FROM feedback WHERE mood IS NOT NULL AND created_at > ? GROUP BY mood").all(since);
  const moods = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0, sum = 0;
  for (const r of moodRows) { moods[r.mood] = r.n; total += r.n; sum += r.mood * r.n; }
  res.set("Cache-Control", "no-store");
  res.json({
    counts, byKind,
    mood: { last30days: { n: total, average: total ? Math.round((sum / total) * 100) / 100 : null, byMood: moods } },
    feedback: rows.map(adminShape),
  });
});

feedback.post("/admin/feedback/:id", adminFailures, requireAdminKey, (req, res) => {
  const row = db.prepare("SELECT * FROM feedback WHERE id = ?").get(String(req.params.id));
  if (!row) return res.status(404).json({ error: { message: "Not found." } });
  const b = req.body || {};
  let status = row.status, reply = row.reply, repliedAt = row.replied_at;
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) return res.status(400).json({ error: { message: "Unknown status." } });
    status = b.status;
  }
  if (b.reply !== undefined) {
    const text = typeof b.reply === "string" ? b.reply.trim() : null;
    if (text == null || text.length > FEEDBACK_LIMITS.replyMax) {
      return res.status(400).json({ error: { message: "A reply is up to 500 characters." } });
    }
    // An anonymous message has nobody to read the answer.
    if (text && row.user_id == null) return res.status(400).json({ error: { message: "That sender chose to stay anonymous." } });
    reply = text;
    repliedAt = text ? Date.now() : null;
  }
  db.prepare("UPDATE feedback SET status = ?, reply = ?, replied_at = ?, updated_at = ? WHERE id = ?")
    .run(status, reply, repliedAt, Date.now(), row.id);
  res.json({ ok: true });
});

feedback.delete("/admin/feedback/:id", adminFailures, requireAdminKey, (req, res) => {
  const info = db.prepare("DELETE FROM feedback WHERE id = ?").run(String(req.params.id));
  if (!info.changes) return res.status(404).json({ error: { message: "Not found." } });
  res.json({ ok: true });
});

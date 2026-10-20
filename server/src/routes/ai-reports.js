import { Router } from "express";
import crypto from "node:crypto";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { attemptLimit } from "../middleware/attemptLimit.js";
import { sendNewAiReportEmail } from "../email.js";
import { adminFailures, requireAdminKey } from "../middleware/adminKey.js";

export const aiReports = Router();

// "Report this answer" on an AI reply (the tutor in a session, PluggEra AI in #/solve). The App Store asks
// apps whose AI writes content for a way to report offensive output, and a wrong answer is worth knowing
// about too. The flow mirrors reviews.js:
//   POST   /api/ai-reports            a signed-in student reports one answer -> 'open', and the owner is mailed
//   GET    /api/admin/ai-reports      the queue (#/admin/ai-reports), for whoever holds REVIEW_ADMIN_KEY
//   POST   /api/admin/ai-reports/:id  mark one handled, or open again
//   DELETE /api/admin/ai-reports/:id  remove one
// The moderator sees the answer, what the student had asked and why they reported it - never who sent it.

export const AI_REPORT_LIMITS = { contentMax: 4000, promptMax: 1000, noteMax: 500 };
const WHERE = new Set(["tutor", "solve"]);
const REASONS = new Set(["wrong", "harmful", "other"]);

// A student reports a few answers at most; this only stops a script from filling the queue and the inbox.
const submitLimit = attemptLimit({
  name: "ai-report-submit", max: Number(process.env.AI_REPORTS_PER_HOUR_PER_USER ?? 20), windowMs: 60 * 60_000,
  key: (req) => req.user?.userId,
});

const clip = (v, max) => String(v ?? "").trim().slice(0, max);

aiReports.post("/ai-reports", requireAuth, submitLimit, (req, res) => {
  const b = req.body || {};
  if (!WHERE.has(b.where)) return res.status(400).json({ error: { message: "Unknown place.", code: "ai_report_where" } });
  if (!REASONS.has(b.reason)) return res.status(400).json({ error: { message: "Pick a reason.", code: "ai_report_reason" } });
  const content = clip(b.content, AI_REPORT_LIMITS.contentMax);
  if (!content) return res.status(400).json({ error: { message: "Nothing to report.", code: "ai_report_content" } });
  const prompt = clip(b.prompt, AI_REPORT_LIMITS.promptMax);
  const note = clip(b.note, AI_REPORT_LIMITS.noteMax);

  db.prepare(`
    INSERT INTO ai_reports (id, user_id, where_from, reason, note, content, prompt, status, created_at, handled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, NULL)
  `).run(crypto.randomUUID(), req.user.userId, b.where, b.reason, note, content, prompt, Date.now());
  // Best-effort and not waited for, as with reviews: the student's answer must not depend on the mail.
  sendNewAiReportEmail({ where: b.where, reason: b.reason, note, content, prompt });
  res.json({ ok: true });
});

/* ---------------- moderation ---------------- */

const shape = (r) => ({
  id: r.id, status: r.status, where: r.where_from, reason: r.reason,
  note: r.note, content: r.content, prompt: r.prompt,
  date: new Date(r.created_at).toISOString().slice(0, 10),
});

aiReports.get("/admin/ai-reports", adminFailures, requireAdminKey, (req, res) => {
  const status = req.query.status === "handled" ? "handled" : "open";
  const rows = db.prepare("SELECT * FROM ai_reports WHERE status = ? ORDER BY created_at DESC LIMIT 200").all(status);
  const counts = Object.fromEntries(
    db.prepare("SELECT status, COUNT(*) AS n FROM ai_reports GROUP BY status").all().map((r) => [r.status, r.n])
  );
  res.set("Cache-Control", "no-store");
  res.json({ counts: { open: counts.open || 0, handled: counts.handled || 0 }, reports: rows.map(shape) });
});

aiReports.post("/admin/ai-reports/:id", adminFailures, requireAdminKey, (req, res) => {
  const status = req.body?.status;
  if (status !== "handled" && status !== "open") {
    return res.status(400).json({ error: { message: "Status must be handled or open." } });
  }
  const info = db.prepare("UPDATE ai_reports SET status = ?, handled_at = ? WHERE id = ?")
    .run(status, status === "handled" ? Date.now() : null, String(req.params.id));
  if (!info.changes) return res.status(404).json({ error: { message: "Not found." } });
  res.json({ ok: true });
});

aiReports.delete("/admin/ai-reports/:id", adminFailures, requireAdminKey, (req, res) => {
  const info = db.prepare("DELETE FROM ai_reports WHERE id = ?").run(String(req.params.id));
  if (!info.changes) return res.status(404).json({ error: { message: "Not found." } });
  res.json({ ok: true });
});

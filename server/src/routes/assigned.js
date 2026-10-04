import { Router } from "express";
import crypto from "node:crypto";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireActiveLink } from "../middleware/requireActiveLink.js";

export const assigned = Router();

const MAX_DOC_CHARS = 500_000;
const MAX_WAITING = 50;

// A parent assigns one of their own sets (the same {title,subject,questions:
// [...]} doc shape generateAssignment()/addAssignmentDoc() already use) to a
// linked student. Kept out of state_blobs entirely.
assigned.post("/assigned", requireAuth, requireActiveLink((req) => req.body?.studentUserId), (req, res) => {
  const { studentUserId, doc, dueAt } = req.body || {};
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return res.status(400).json({ error: { message: "doc is required." } });
  // A set is a few hundred questions at most; a queue of them a student hasn't opened yet is a few
  // dozen. Without these, two linked accounts could fill the disk 10 MB at a time.
  const json = JSON.stringify(doc);
  if (json.length > MAX_DOC_CHARS) return res.status(413).json({ error: { message: "That set is too large to assign." } });
  const waiting = db.prepare("SELECT COUNT(*) AS n FROM assigned_sets WHERE student_user_id = ?").get(studentUserId).n;
  if (waiting >= MAX_WAITING) return res.status(429).json({ error: { message: "This student already has many assigned sets waiting." } });

  const id = crypto.randomUUID();
  db.prepare("INSERT INTO assigned_sets (id, student_user_id, assigned_by_user_id, doc, due_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, studentUserId, req.user.userId, json, typeof dueAt === "string" ? dueAt.slice(0, 10) : null, Date.now());
  res.json({ id });
});

// The signed-in student's pending assignments, from any linked parent/teacher.
assigned.get("/assigned-for-me", requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT assigned_sets.id, assigned_sets.doc, assigned_sets.due_at AS dueAt, assigned_sets.created_at AS createdAt,
           users.email AS assignedByEmail
    FROM assigned_sets JOIN users ON users.id = assigned_sets.assigned_by_user_id
    WHERE assigned_sets.student_user_id = ?
    ORDER BY assigned_sets.created_at DESC
  `).all(req.user.userId);

  res.json(rows.map((r) => ({ ...r, doc: JSON.parse(r.doc) })));
});

// The student calls this once they've imported the set locally, to clear it
// from their queue.
assigned.delete("/assigned/:id", requireAuth, (req, res) => {
  const row = db.prepare("SELECT student_user_id FROM assigned_sets WHERE id = ?").get(req.params.id);
  if (!row || row.student_user_id !== req.user.userId) {
    return res.status(404).json({ error: { message: "Not found." } });
  }
  db.prepare("DELETE FROM assigned_sets WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

import { Router } from "express";
import crypto from "node:crypto";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const links = Router();

const CODE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function randomCode() {
  // Short, human-typeable: 6 uppercase alphanumerics, ambiguous chars dropped.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

// A student generates a short-lived code for a parent/teacher to redeem.
links.post("/links/invite-code", requireAuth, (req, res) => {
  const id = crypto.randomUUID();
  const code = randomCode();
  const now = Date.now();
  db.prepare("INSERT INTO invite_codes (id, student_user_id, code, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, req.user.userId, code, now + CODE_TTL_MS, now);
  res.json({ code, expiresAt: now + CODE_TTL_MS });
});

// A parent/teacher redeems a student's code to create the link.
links.post("/links/redeem", requireAuth, (req, res) => {
  const code = String(req.body?.code || "").trim().toUpperCase();
  if (!code) return res.status(400).json({ error: { message: "Enter a code." } });

  const invite = db.prepare("SELECT * FROM invite_codes WHERE code = ?").get(code);
  if (!invite || invite.used_at || invite.expires_at < Date.now()) {
    return res.status(400).json({ error: { message: "That code is invalid or has expired." } });
  }
  if (invite.student_user_id === req.user.userId) {
    return res.status(400).json({ error: { message: "You can't link to your own account." } });
  }

  const student = db.prepare("SELECT email FROM users WHERE id = ?").get(invite.student_user_id);
  const now = Date.now();
  db.prepare(`
    INSERT INTO links (id, parent_user_id, student_user_id, status, created_at) VALUES (?, ?, ?, 'active', ?)
    ON CONFLICT(parent_user_id, student_user_id) DO UPDATE SET status = 'active'
  `).run(crypto.randomUUID(), req.user.userId, invite.student_user_id, now);
  db.prepare("UPDATE invite_codes SET used_at = ? WHERE id = ?").run(now, invite.id);

  res.json({ studentEmail: student.email });
});

// This account's links in both directions.
links.get("/links", requireAuth, (req, res) => {
  const asParent = db.prepare(`
    SELECT links.id AS linkId, users.id AS studentUserId, users.email AS studentEmail
    FROM links JOIN users ON users.id = links.student_user_id
    WHERE links.parent_user_id = ? AND links.status = 'active'
  `).all(req.user.userId);

  const asStudent = db.prepare(`
    SELECT links.id AS linkId, users.id AS parentUserId, users.email AS parentEmail
    FROM links JOIN users ON users.id = links.parent_user_id
    WHERE links.student_user_id = ? AND links.status = 'active'
  `).all(req.user.userId);

  res.json({ asParent, asStudent });
});

links.delete("/links/:linkId", requireAuth, (req, res) => {
  const row = db.prepare("SELECT * FROM links WHERE id = ?").get(req.params.linkId);
  if (!row || (row.parent_user_id !== req.user.userId && row.student_user_id !== req.user.userId)) {
    return res.status(404).json({ error: { message: "Link not found." } });
  }
  db.prepare("DELETE FROM links WHERE id = ?").run(req.params.linkId);
  res.json({ ok: true });
});

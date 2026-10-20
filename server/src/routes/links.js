import { Router } from "express";
import crypto from "node:crypto";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { codeGuessLimits } from "../middleware/authLimits.js";
import { TOO_MANY_MESSAGE } from "../middleware/attemptLimit.js";
import { issueCode } from "../codes.js";
import { displayNames } from "../state-digest.js";

export const links = Router();

// A student generates a short-lived code for a parent/teacher to redeem. While one is still unused and
// valid it is given out again rather than a new row written (see codes.js).
links.post("/links/invite-code", requireAuth, (req, res) => {
  const issued = issueCode("invite", req.user.userId);
  if (!issued) return res.status(429).set("Retry-After", "600").json({ error: { message: TOO_MANY_MESSAGE, code: "too_many_codes" } });
  res.json({ code: issued.code, expiresAt: issued.expiresAt });
});

// The same invitation as a link: a long token the app puts after "#/join/parent/". Good for a day, once.
links.post("/links/invite-link", requireAuth, (req, res) => {
  const issued = issueCode("inviteLink", req.user.userId);
  if (!issued) return res.status(429).set("Retry-After", "600").json({ error: { message: TOO_MANY_MESSAGE, code: "too_many_codes" } });
  res.json({ token: issued.code, expiresAt: issued.expiresAt });
});

// The invitation a request names, from either a student's code or a link's token: { table, row } (row may be undefined),
// or null when it names neither. Table names are fixed here.
function findInvite(body) {
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (token) return { table: "invite_links", row: db.prepare("SELECT * FROM invite_links WHERE code = ?").get(token), kind: "link" };
  const code = String(body?.code || "").trim().toUpperCase();
  if (!code) return null;
  return { table: "invite_codes", row: db.prepare("SELECT * FROM invite_codes WHERE code = ?").get(code), kind: "code" };
}

const gone = (kind) => (kind === "link" ? "This invitation is invalid or has expired." : "That code is invalid or has expired.");

// What a link is for, shown before it is used: who is inviting. Nothing is changed. Needs a session, like redeeming does.
links.post("/links/preview", requireAuth, ...codeGuessLimits, (req, res) => {
  const found = findInvite({ token: req.body?.token });
  if (!found) return res.status(400).json({ error: { message: "Open the link again." } });
  const { row, kind } = found;
  if (!row || row.used_at || row.expires_at < Date.now()) return res.status(400).json({ error: { message: gone(kind) } });
  if (row.student_user_id === req.user.userId) return res.status(400).json({ error: { message: "You can't link to your own account." } });
  // A first name or a shortened address, never the whole address of a person only known by a link.
  res.json({ studentName: displayNames([row.student_user_id]).get(row.student_user_id) });
});

// A parent/teacher redeems a student's code (or link) to create the link.
links.post("/links/redeem", requireAuth, ...codeGuessLimits, (req, res) => {
  const found = findInvite(req.body);
  if (!found) return res.status(400).json({ error: { message: "Enter a code." } });
  const { table, row: invite, kind } = found;
  if (!invite || invite.used_at || invite.expires_at < Date.now()) {
    return res.status(400).json({ error: { message: gone(kind) } });
  }
  if (invite.student_user_id === req.user.userId) {
    return res.status(400).json({ error: { message: "You can't link to your own account." } });
  }

  const student = db.prepare("SELECT email FROM users WHERE id = ?").get(invite.student_user_id);
  const now = Date.now();
  // Using it up and making the link are one step, and only the request that wins the use gets the link: two
  // people opening the same single-use link at once cannot both become the student's parent.
  const claimed = db.transaction(() => {
    if (db.prepare(`UPDATE ${table} SET used_at = ? WHERE id = ? AND used_at IS NULL`).run(now, invite.id).changes !== 1) return false;
    db.prepare(`
      INSERT INTO links (id, parent_user_id, student_user_id, status, created_at) VALUES (?, ?, ?, 'active', ?)
      ON CONFLICT(parent_user_id, student_user_id) DO UPDATE SET status = 'active'
    `).run(crypto.randomUUID(), req.user.userId, invite.student_user_id, now);
    return true;
  })();
  if (!claimed) return res.status(400).json({ error: { message: gone(kind) } });

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

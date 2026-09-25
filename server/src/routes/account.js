import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "../db.js";
import { COOKIE_NAME } from "../constants.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { attemptLimit } from "../middleware/attemptLimit.js";

export const account = Router();

// A wrong password here is the only thing worth guessing at (the caller already holds a
// session), so only those count — 5 per 15 minutes per account.
const deleteFailures = attemptLimit({
  name: "account-delete-fail", max: 5, windowMs: 15 * 60_000, failureStatuses: [403],
  key: (req) => req.user?.userId,
});

// Erase the signed-in account and everything the server holds about it: the login, every session
// (so other devices are signed out), the synced study data, parent/friend links and their codes,
// sets assigned to or by them, AI usage, their review of Studify (approved or not), any outstanding verify/reset email token, a premium-waitlist
// entry under the account's own email, their own answers to any class's daily question, and — for a
// teacher — their classes with all members, assignments, and daily questions (with everyone's
// answers to them). Each table is named here on
// purpose; the schema also cascades (db.js turns that enforcement on), but a delete that people
// rely on for their privacy shouldn't depend on a pragma.
//
// To make sure it's really them (a session cookie alone can be left on a shared computer), a
// password account must send its password; a Google-only account has none, so it sends its email.
account.delete("/account", requireAuth, deleteFailures, asyncHandler(async (req, res) => {
  const { userId } = req.user;
  const user = db.prepare("SELECT id, email, password_hash, google_sub FROM users WHERE id = ?").get(userId);
  if (!user) return res.status(404).json({ error: { message: "Not found." } });

  if (user.google_sub) {
    const typed = String(req.body?.email || "").trim().toLowerCase();
    if (typed !== user.email) {
      return res.status(403).json({ error: { message: "That email doesn't match this account.", code: "confirm_mismatch" } });
    }
  } else {
    const password = String(req.body?.password || "").slice(0, 200);
    if (!(await bcrypt.compare(password, user.password_hash))) {
      return res.status(403).json({ error: { message: "That password is wrong.", code: "confirm_mismatch" } });
    }
  }

  db.transaction(() => {
    const taught = db.prepare("SELECT id FROM classes WHERE teacher_user_id = ?").all(userId).map((r) => r.id);
    for (const classId of taught) {
      // Children of class_daily first — daily_id would otherwise dangle for an instant mid-transaction.
      db.prepare("DELETE FROM class_daily_answers WHERE daily_id IN (SELECT id FROM class_daily WHERE class_id = ?)").run(classId);
      db.prepare("DELETE FROM class_daily WHERE class_id = ?").run(classId);
      db.prepare("DELETE FROM class_assignments WHERE class_id = ?").run(classId);
      db.prepare("DELETE FROM class_members WHERE class_id = ?").run(classId);
    }
    db.prepare("DELETE FROM classes WHERE teacher_user_id = ?").run(userId);
    // Their own answers in any class — including ones they don't teach.
    db.prepare("DELETE FROM class_daily_answers WHERE student_user_id = ?").run(userId);
    db.prepare("DELETE FROM class_members WHERE student_user_id = ?").run(userId);
    db.prepare("DELETE FROM assigned_sets WHERE student_user_id = ? OR assigned_by_user_id = ?").run(userId, userId);
    db.prepare("DELETE FROM links WHERE parent_user_id = ? OR student_user_id = ?").run(userId, userId);
    db.prepare("DELETE FROM invite_codes WHERE student_user_id = ?").run(userId);
    db.prepare("DELETE FROM friend_links WHERE user_a_id = ? OR user_b_id = ?").run(userId, userId);
    db.prepare("DELETE FROM friend_codes WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM email_verify_tokens WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(userId);
    // The premium waitlist is keyed by address, not account, so only a row under this account's own
    // email can be tied to it - one they joined with some other address (a parent's, say) stays.
    db.prepare("DELETE FROM premium_waitlist WHERE email = ?").run(user.email);
    db.prepare("DELETE FROM ai_usage WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM reviews WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM state_blobs WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  })();

  console.log("[account] deleted", userId);   // the id only — never the email
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
}));

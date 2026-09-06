import { Router } from "express";
import crypto from "node:crypto";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const friends = Router();

const CODE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function randomCode() {
  // Short, human-typeable: 6 uppercase alphanumerics, ambiguous chars dropped.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

// Canonical, order-independent pair — the smaller id is always stored first,
// so a friendship is one row regardless of which side queries it.
function pair(a, b) { return a < b ? [a, b] : [b, a]; }

function friendEmail(userId) {
  return db.prepare("SELECT email FROM users WHERE id = ?").get(userId)?.email || null;
}

friends.post("/friends/invite-code", requireAuth, (req, res) => {
  const id = crypto.randomUUID();
  const code = randomCode();
  const now = Date.now();
  db.prepare("INSERT INTO friend_codes (id, user_id, code, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, req.user.userId, code, now + CODE_TTL_MS, now);
  res.json({ code, expiresAt: now + CODE_TTL_MS });
});

friends.post("/friends/redeem", requireAuth, (req, res) => {
  const code = String(req.body?.code || "").trim().toUpperCase();
  if (!code) return res.status(400).json({ error: { message: "Enter a code." } });

  const invite = db.prepare("SELECT * FROM friend_codes WHERE code = ?").get(code);
  if (!invite || invite.used_at || invite.expires_at < Date.now()) {
    return res.status(400).json({ error: { message: "That code is invalid or has expired." } });
  }
  if (invite.user_id === req.user.userId) {
    return res.status(400).json({ error: { message: "You can't add yourself as a friend." } });
  }

  const [a, b] = pair(req.user.userId, invite.user_id);
  const now = Date.now();
  db.prepare(`
    INSERT INTO friend_links (id, user_a_id, user_b_id, status, created_at) VALUES (?, ?, ?, 'active', ?)
    ON CONFLICT(user_a_id, user_b_id) DO UPDATE SET status = 'active'
  `).run(crypto.randomUUID(), a, b, now);
  db.prepare("UPDATE friend_codes SET used_at = ? WHERE id = ?").run(now, invite.id);

  res.json({ friendEmail: friendEmail(invite.user_id) });
});

friends.delete("/friends/:linkId", requireAuth, (req, res) => {
  const row = db.prepare("SELECT * FROM friend_links WHERE id = ?").get(req.params.linkId);
  if (!row || (row.user_a_id !== req.user.userId && row.user_b_id !== req.user.userId)) {
    return res.status(404).json({ error: { message: "Friend not found." } });
  }
  db.prepare("DELETE FROM friend_links WHERE id = ?").run(req.params.linkId);
  res.json({ ok: true });
});

function activeFriendIds(userId) {
  return db.prepare(`
    SELECT id AS linkId, CASE WHEN user_a_id = ? THEN user_b_id ELSE user_a_id END AS friendUserId
    FROM friend_links
    WHERE (user_a_id = ? OR user_b_id = ?) AND status = 'active'
  `).all(userId, userId, userId);
}

// This week's questions answered, and current streak, for the signed-in user
// and every active friend — resets weekly (a lifetime-total leaderboard would
// just be permanently led by whoever joined first). Streak/week boundaries
// are computed in server UTC rather than each student's own local time, since
// nothing in state_blobs records a timezone — close enough for a friendly
// comparison, not meant to be exact to the hour.
friends.get("/friends/leaderboard", requireAuth, (req, res) => {
  const friendRows = activeFriendIds(req.user.userId);
  const linkIdFor = new Map(friendRows.map((r) => [r.friendUserId, r.linkId]));
  const userIds = [req.user.userId, ...friendRows.map((r) => r.friendUserId)];
  const weekStart = startOfWeekUTC(Date.now());

  const entries = userIds.map((userId) => {
    const row = db.prepare("SELECT blob FROM state_blobs WHERE user_id = ?").get(userId);
    const blob = row ? JSON.parse(row.blob) : null;
    const attempts = blob?.attempts || [];
    const questionsThisWeek = attempts
      .filter((a) => (a.finishedAt || 0) >= weekStart)
      .reduce((n, a) => n + (a.items?.length || 0), 0);
    return {
      userId,
      linkId: linkIdFor.get(userId) || null,
      email: friendEmail(userId),
      isMe: userId === req.user.userId,
      synced: !!row,
      questionsThisWeek,
      streak: currentStreakFromUTC(blob?.activity?.daysStudied || [], blob?.activity?.frozenDays || []),
    };
  });

  entries.sort((a, b) => b.questionsThisWeek - a.questionsThisWeek || b.streak - a.streak);
  res.json({ weekStart, entries });
});

function startOfWeekUTC(nowMs) {
  const d = new Date(nowMs);
  const diffToMonday = (d.getUTCDay() + 6) % 7; // days since Monday (0=Sun..6=Sat)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diffToMonday, 0, 0, 0, 0);
}

// Same algorithm as js/lib/activity.js's currentStreak(), duplicated here in
// UTC terms — the server can't import that frontend module, and the function
// is small enough that hand-keeping it in sync beats a build step for one
// function. frozenDays (the streak-freeze mechanic) count the same as a
// studied day, so a friend's leaderboard streak matches their own Progress.
function currentStreakFromUTC(daysStudied, frozenDays = []) {
  if ((!daysStudied || !daysStudied.length) && (!frozenDays || !frozenDays.length)) return 0;
  const days = new Set([...(daysStudied || []), ...(frozenDays || [])]);
  const today = dayKeyUTC(Date.now());
  let cursor = days.has(today) ? today : addDaysUTC(today, -1);
  if (!days.has(cursor)) return 0;
  let n = 0;
  while (days.has(cursor)) { n++; cursor = addDaysUTC(cursor, -1); }
  return n;
}
function dayKeyUTC(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function addDaysUTC(dayKey, delta) {
  const [y, m, dd] = dayKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, dd));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dayKeyUTC(dt.getTime());
}

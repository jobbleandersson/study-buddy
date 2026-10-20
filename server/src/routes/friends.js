import { Router } from "express";
import crypto from "node:crypto";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { codeGuessLimits } from "../middleware/authLimits.js";
import { TOO_MANY_MESSAGE } from "../middleware/attemptLimit.js";
import { issueCode } from "../codes.js";
import { readDigest, displayNames } from "../state-digest.js";

export const friends = Router();

// Canonical, order-independent pair — the smaller id is always stored first,
// so a friendship is one row regardless of which side queries it.
function pair(a, b) { return a < b ? [a, b] : [b, a]; }

// A friend code is short-lived; while one is still unused and valid it is given out again rather than a new
// row written (see codes.js).
friends.post("/friends/invite-code", requireAuth, (req, res) => {
  const issued = issueCode("friend", req.user.userId);
  if (!issued) return res.status(429).set("Retry-After", "600").json({ error: { message: TOO_MANY_MESSAGE, code: "too_many_codes" } });
  res.json({ code: issued.code, expiresAt: issued.expiresAt });
});

// The same invitation as a link: a long token the app puts after "#/join/friend/". Good for a day, once.
friends.post("/friends/invite-link", requireAuth, (req, res) => {
  const issued = issueCode("friendLink", req.user.userId);
  if (!issued) return res.status(429).set("Retry-After", "600").json({ error: { message: TOO_MANY_MESSAGE, code: "too_many_codes" } });
  res.json({ token: issued.code, expiresAt: issued.expiresAt });
});

// The invitation a request names, from a friend code or a link's token: { table, row (maybe undefined), kind }, or null
// when it names neither. Table names are fixed here.
function findInvite(body) {
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (token) return { table: "friend_invite_links", row: db.prepare("SELECT * FROM friend_invite_links WHERE code = ?").get(token), kind: "link" };
  const code = String(body?.code || "").trim().toUpperCase();
  if (!code) return null;
  return { table: "friend_codes", row: db.prepare("SELECT * FROM friend_codes WHERE code = ?").get(code), kind: "code" };
}
const gone = (kind) => (kind === "link" ? "This invitation is invalid or has expired." : "That code is invalid or has expired.");

// Who is asking, shown before a friend link is used. Nothing is changed. Needs a session, like redeeming does.
friends.post("/friends/preview", requireAuth, ...codeGuessLimits, (req, res) => {
  const found = findInvite({ token: req.body?.token });
  if (!found) return res.status(400).json({ error: { message: "Open the link again." } });
  const { row, kind } = found;
  if (!row || row.used_at || row.expires_at < Date.now()) return res.status(400).json({ error: { message: gone(kind) } });
  if (row.user_id === req.user.userId) return res.status(400).json({ error: { message: "You can't add yourself as a friend." } });
  const [a, b] = pair(req.user.userId, row.user_id);
  const already = !!db.prepare("SELECT 1 FROM friend_links WHERE user_a_id = ? AND user_b_id = ? AND status = 'active'").get(a, b);
  // A first name or a shortened address, never the whole address of a person only known by a link.
  res.json({ friendName: displayNames([row.user_id]).get(row.user_id), alreadyFriends: already });
});

friends.post("/friends/redeem", requireAuth, ...codeGuessLimits, (req, res) => {
  const found = findInvite(req.body);
  if (!found) return res.status(400).json({ error: { message: "Enter a code." } });
  const { table, row: invite, kind } = found;
  if (!invite || invite.used_at || invite.expires_at < Date.now()) {
    return res.status(400).json({ error: { message: gone(kind) } });
  }
  if (invite.user_id === req.user.userId) {
    return res.status(400).json({ error: { message: "You can't add yourself as a friend." } });
  }

  const [a, b] = pair(req.user.userId, invite.user_id);
  const now = Date.now();
  // Using it up and making the friendship are one step, and only the request that wins the use gets it.
  const claimed = db.transaction(() => {
    if (db.prepare(`UPDATE ${table} SET used_at = ? WHERE id = ? AND used_at IS NULL`).run(now, invite.id).changes !== 1) return false;
    db.prepare(`
      INSERT INTO friend_links (id, user_a_id, user_b_id, status, created_at) VALUES (?, ?, ?, 'active', ?)
      ON CONFLICT(user_a_id, user_b_id) DO UPDATE SET status = 'active'
    `).run(crypto.randomUUID(), a, b, now);
    return true;
  })();
  if (!claimed) return res.status(400).json({ error: { message: gone(kind) } });

  res.json({ friendName: displayNames([invite.user_id]).get(invite.user_id) });
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

  // What this page needs from each person's saved state comes from its small summary (state-digest.js,
  // already checked and cut down when it was saved), not from parsing the whole state — up to 10 MB —
  // of every friend on every view. A person who never synced has none (digest is null).
  const digests = new Map(userIds.map((id) => [id, readDigest(id)]));
  const names = displayNames(userIds.filter((id) => id !== req.user.userId), digests);
  const entries = userIds.map((userId) => {
    const digest = digests.get(userId);
    const questionsThisWeek = (digest?.attempts || [])
      .filter(([at]) => at >= weekStart && at < weekStart + 7 * 86_400_000)
      .reduce((n, [, answered]) => n + answered, 0);
    return {
      userId,
      linkId: linkIdFor.get(userId) || null,
      // A first name or a masked address, never the address itself: a friend code is shared in chats
      // and a stranger who gets one must not walk away with a minor's email.
      name: names.get(userId) ?? null,
      isMe: userId === req.user.userId,
      synced: !!digest,
      avatar: digest?.avatar ?? null,
      questionsThisWeek,
      streak: currentStreakFromUTC(digest?.days, digest?.frozen),
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

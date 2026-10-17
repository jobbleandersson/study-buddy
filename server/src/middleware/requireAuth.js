import { db } from "../db.js";
import { COOKIE_NAME } from "../constants.js";
import { renewSession } from "../session.js";

export function requireAuth(req, res, next) {
  const sid = req.cookies?.[COOKIE_NAME];
  if (!sid) return res.status(401).json({ error: { message: "Not signed in.", code: "not_authenticated" } });

  const row = db.prepare(
    `SELECT sessions.user_id AS userId, users.email AS email, sessions.expires_at AS sessionEnds, sessions.created_at AS sessionStarted
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.id = ? AND sessions.expires_at > ?`
  ).get(sid, Date.now());

  if (!row) return res.status(401).json({ error: { message: "Session expired.", code: "not_authenticated" } });
  renewSession(res, sid, row.sessionEnds, row.sessionStarted);
  req.user = { userId: row.userId, email: row.email };
  next();
}

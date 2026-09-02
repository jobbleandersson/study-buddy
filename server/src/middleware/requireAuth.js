import { db } from "../db.js";
import { COOKIE_NAME } from "../constants.js";

export function requireAuth(req, res, next) {
  const sid = req.cookies?.[COOKIE_NAME];
  if (!sid) return res.status(401).json({ error: { message: "Not signed in." } });

  const row = db.prepare(
    `SELECT sessions.user_id AS userId, users.email AS email
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.id = ? AND sessions.expires_at > ?`
  ).get(sid, Date.now());

  if (!row) return res.status(401).json({ error: { message: "Session expired." } });
  req.user = row;
  next();
}

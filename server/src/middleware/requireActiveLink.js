import { db } from "../db.js";

// Guards a route so req.user must have an active parent-link to the student
// id the given function extracts from the request (body param or URL param).
export function requireActiveLink(getStudentUserId) {
  return (req, res, next) => {
    const studentUserId = getStudentUserId(req);
    // A body value can be anything JSON allows; an object or array would make the SQLite bind throw (a 500
    // and an owner alert), so only a string gets as far as the query.
    if (!studentUserId || typeof studentUserId !== "string") return res.status(400).json({ error: { message: "studentUserId is required." } });

    const link = db.prepare(
      "SELECT id FROM links WHERE parent_user_id = ? AND student_user_id = ? AND status = 'active'"
    ).get(req.user.userId, studentUserId);

    if (!link) return res.status(403).json({ error: { message: "Not linked to that student." } });
    next();
  };
}

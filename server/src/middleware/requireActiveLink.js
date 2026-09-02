import { db } from "../db.js";

// Guards a route so req.user must have an active parent-link to the student
// id the given function extracts from the request (body param or URL param).
export function requireActiveLink(getStudentUserId) {
  return (req, res, next) => {
    const studentUserId = getStudentUserId(req);
    if (!studentUserId) return res.status(400).json({ error: { message: "studentUserId is required." } });

    const link = db.prepare(
      "SELECT id FROM links WHERE parent_user_id = ? AND student_user_id = ? AND status = 'active'"
    ).get(req.user.userId, studentUserId);

    if (!link) return res.status(403).json({ error: { message: "Not linked to that student." } });
    next();
  };
}

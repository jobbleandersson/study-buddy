import { Router } from "express";
import crypto from "node:crypto";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { librarySet } from "../library-data.js";
import { studentSetProgress, classTopics } from "../class-stats.js";
import { codeGuessLimits } from "../middleware/authLimits.js";
import { isUniqueViolation } from "../errors.js";

// Class mode: a teacher creates a class, students join with its code, the
// teacher assigns ready-made library sets to the whole class and sees how
// everyone is doing. Anyone signed in can teach a class and be in one — there
// are no roles, same as the parent/student links.

export const classes = Router();

const MAX_CLASSES = 20;      // per teacher
const MAX_MEMBERS = 200;     // per class
const MAX_ASSIGNMENTS = 50;  // per class

const fail = (res, status, message) => res.status(status).json({ error: { message } });

// Six characters, ambiguous ones (0/O, 1/I) left out — same as the other codes.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randomCode() {
  let out = "";
  for (let i = 0; i < 6; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

const cleanName = (s) => String(s ?? "").replace(/[\x00-\x1f\x7f]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);

function validDay(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
}

// The class, if the signed-in user teaches it; otherwise answers 404 itself.
function teacherClass(req, res) {
  const row = db.prepare("SELECT * FROM classes WHERE id = ? AND teacher_user_id = ?").get(req.params.id, req.user.userId);
  if (!row) fail(res, 404, "Class not found.");
  return row || null;
}

classes.post("/classes", requireAuth, (req, res) => {
  const name = cleanName(req.body?.name);
  if (!name) return fail(res, 400, "Enter a class name.");
  const owned = db.prepare("SELECT COUNT(*) AS n FROM classes WHERE teacher_user_id = ?").get(req.user.userId).n;
  if (owned >= MAX_CLASSES) return fail(res, 400, `You can have up to ${MAX_CLASSES} classes.`);

  const id = crypto.randomUUID();
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = randomCode();
    try {
      db.prepare("INSERT INTO classes (id, teacher_user_id, name, code, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(id, req.user.userId, name, code, Date.now());
      return res.json({ id, name, code });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;   // a code clash: pick another
    }
  }
  fail(res, 500, "Couldn't create the class. Try again.");
});

// A student joins with the class code. Joining is also their agreement that
// the teacher sees their results on the sets assigned to the class.
classes.post("/classes/join", requireAuth, ...codeGuessLimits, (req, res) => {
  const code = String(req.body?.code || "").trim().toUpperCase();
  if (!code) return fail(res, 400, "Enter a code.");
  const cls = db.prepare("SELECT * FROM classes WHERE code = ?").get(code);
  if (!cls) return fail(res, 400, "That code is invalid or has expired.");
  if (cls.teacher_user_id === req.user.userId) return fail(res, 400, "You can't join your own class.");

  const members = db.prepare("SELECT COUNT(*) AS n FROM class_members WHERE class_id = ?").get(cls.id).n;
  const already = db.prepare("SELECT 1 AS x FROM class_members WHERE class_id = ? AND student_user_id = ?").get(cls.id, req.user.userId);
  if (!already && members >= MAX_MEMBERS) return fail(res, 400, "This class is full.");

  db.prepare("INSERT OR IGNORE INTO class_members (class_id, student_user_id, joined_at) VALUES (?, ?, ?)")
    .run(cls.id, req.user.userId, Date.now());
  res.json({ id: cls.id, name: cls.name });
});

// Classes this account teaches, and classes it's a student in.
classes.get("/classes", requireAuth, (req, res) => {
  const teaching = db.prepare(`
    SELECT c.id, c.name, c.code, c.created_at AS createdAt,
           (SELECT COUNT(*) FROM class_members m WHERE m.class_id = c.id) AS memberCount,
           (SELECT COUNT(*) FROM class_assignments a WHERE a.class_id = c.id) AS assignmentCount
    FROM classes c WHERE c.teacher_user_id = ? ORDER BY c.created_at DESC
  `).all(req.user.userId);

  const member = db.prepare(`
    SELECT c.id, c.name, u.email AS teacherEmail, m.joined_at AS joinedAt
    FROM class_members m
    JOIN classes c ON c.id = m.class_id
    JOIN users u ON u.id = c.teacher_user_id
    WHERE m.student_user_id = ? ORDER BY m.joined_at DESC
  `).all(req.user.userId);

  res.json({ teaching, member });
});

// One class, for its teacher: who's in it and what's been assigned.
classes.get("/classes/:id", requireAuth, (req, res) => {
  const cls = teacherClass(req, res);
  if (!cls) return;
  const members = db.prepare(`
    SELECT u.id AS userId, u.email, m.joined_at AS joinedAt
    FROM class_members m JOIN users u ON u.id = m.student_user_id
    WHERE m.class_id = ? ORDER BY u.email
  `).all(cls.id);
  const assignments = db.prepare(
    "SELECT id, set_id AS setId, due_at AS dueAt, created_at AS createdAt FROM class_assignments WHERE class_id = ? ORDER BY created_at"
  ).all(cls.id).map((a) => ({ ...a, title: librarySet(a.setId)?.title ?? a.setId }));
  res.json({ id: cls.id, name: cls.name, code: cls.code, members, assignments });
});

// How each student is doing on each assigned set, plus the topics the class
// misses most. Read from the students' synced state (see class-stats.js).
classes.get("/classes/:id/results", requireAuth, (req, res) => {
  const cls = teacherClass(req, res);
  if (!cls) return;

  const members = db.prepare(`
    SELECT u.id AS userId, u.email FROM class_members m JOIN users u ON u.id = m.student_user_id
    WHERE m.class_id = ? ORDER BY u.email
  `).all(cls.id);

  const rows = db.prepare(
    "SELECT id, set_id AS setId FROM class_assignments WHERE class_id = ? ORDER BY created_at"
  ).all(cls.id).map((a) => ({ a, set: librarySet(a.setId) }));

  // Each student's state is read once, however many sets are assigned — and only one at a time: the
  // progress on every assigned set is taken from it and the parsed state let go before the next
  // student's is read. Holding every member's state at once could run the server out of memory.
  const progress = new Map();
  for (const m of members) {
    const row = db.prepare("SELECT blob FROM state_blobs WHERE user_id = ?").get(m.userId);
    let blob = null;
    try { blob = row ? JSON.parse(row.blob) : null; } catch { /* unreadable: counts as nothing done */ }
    progress.set(m.userId, rows.map(({ set }) => (set ? studentSetProgress(blob, set) : null)));
  }

  const assignments = rows.map(({ a, set }, i) => {
    if (!set) return { id: a.id, setId: a.setId, total: 0, students: [], topics: [] };
    const perStudent = members.map((m) => ({ m, p: progress.get(m.userId)[i] }));
    return {
      id: a.id,
      setId: a.setId,
      total: set.questions.length,
      students: perStudent.map(({ m, p }) => ({
        userId: m.userId, email: m.email, seen: p.seen, known: p.known, lastAt: p.lastAt,
      })),
      topics: classTopics(perStudent.map(({ p }) => p)).slice(0, 5),
    };
  });

  res.json({ assignments });
});

classes.delete("/classes/:id", requireAuth, (req, res) => {
  const cls = teacherClass(req, res);
  if (!cls) return;
  db.prepare("DELETE FROM classes WHERE id = ?").run(cls.id);
  res.json({ ok: true });
});

classes.post("/classes/:id/assignments", requireAuth, (req, res) => {
  const cls = teacherClass(req, res);
  if (!cls) return;

  const setId = String(req.body?.setId || "");
  if (!librarySet(setId)) return fail(res, 400, "Pick a set from the library.");
  const dueAt = req.body?.dueAt == null || req.body.dueAt === "" ? null : String(req.body.dueAt);
  if (dueAt !== null && !validDay(dueAt)) return fail(res, 400, "That date isn't valid.");

  const existing = db.prepare("SELECT set_id AS setId FROM class_assignments WHERE class_id = ?").all(cls.id);
  if (existing.length >= MAX_ASSIGNMENTS) return fail(res, 400, "This class has too many assignments.");
  if (existing.some((a) => a.setId === setId)) return fail(res, 400, "That set is already assigned to this class.");

  const id = crypto.randomUUID();
  db.prepare("INSERT INTO class_assignments (id, class_id, set_id, due_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, cls.id, setId, dueAt, Date.now());
  res.json({ id });
});

classes.delete("/classes/:id/assignments/:assignmentId", requireAuth, (req, res) => {
  const cls = teacherClass(req, res);
  if (!cls) return;
  db.prepare("DELETE FROM class_assignments WHERE id = ? AND class_id = ?").run(req.params.assignmentId, cls.id);
  res.json({ ok: true });
});

// The teacher removes a student…
classes.delete("/classes/:id/members/:userId", requireAuth, (req, res) => {
  const cls = teacherClass(req, res);
  if (!cls) return;
  db.prepare("DELETE FROM class_members WHERE class_id = ? AND student_user_id = ?").run(cls.id, req.params.userId);
  res.json({ ok: true });
});

// …or a student leaves on their own.
classes.delete("/classes/:id/membership", requireAuth, (req, res) => {
  const result = db.prepare("DELETE FROM class_members WHERE class_id = ? AND student_user_id = ?")
    .run(req.params.id, req.user.userId);
  if (!result.changes) return fail(res, 404, "Class not found.");
  res.json({ ok: true });
});

// What the signed-in student has been given, across every class they're in.
classes.get("/my-class-assignments", requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT a.id, a.class_id AS classId, c.name AS className, a.set_id AS setId, a.due_at AS dueAt, a.created_at AS createdAt
    FROM class_assignments a
    JOIN classes c ON c.id = a.class_id
    JOIN class_members m ON m.class_id = c.id
    WHERE m.student_user_id = ?
    ORDER BY a.created_at DESC
  `).all(req.user.userId);
  res.json(rows);
});

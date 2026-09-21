import { Router } from "express";
import crypto from "node:crypto";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { isUniqueViolation } from "../errors.js";
import {
  validateDaily, validDay, addDays, countsFrom, shownSpread, classStreak, MAX_QUESTIONS_PER_CLASS,
} from "../class-daily.js";

// Dagens fråga. A teacher writes one multiple-choice question for a day; each
// student in the class answers it once and sees how the class did. See
// class-daily.js for what the teacher is (not) shown.

export const classDaily = Router();

const fail = (res, status, message) => res.status(status).json({ error: { message } });
const utcToday = () => new Date().toISOString().slice(0, 10);

// The class, if the signed-in user teaches it; otherwise answers 404 itself.
function teacherClass(req, res) {
  const row = db.prepare("SELECT * FROM classes WHERE id = ? AND teacher_user_id = ?").get(req.params.id, req.user.userId);
  if (!row) fail(res, 404, "Class not found.");
  return row || null;
}

const memberCount = (classId) => db.prepare("SELECT COUNT(*) AS n FROM class_members WHERE class_id = ?").get(classId).n;

/** How one question was answered. Every answer given counts, including from someone who has
 *  since left or been removed: if removing a student changed the spread, a teacher could read
 *  off what that student chose. The displayed head-count is clamped to the class size. */
function answerStats(q, members = memberCount(q.class_id)) {
  const choices = JSON.parse(q.choices);
  const rows = db.prepare("SELECT choice, COUNT(*) AS n FROM class_daily_answers WHERE daily_id = ? GROUP BY choice").all(q.id);
  const counts = countsFrom(rows, choices.length);
  const answered = counts.reduce((a, b) => a + b, 0);
  return { choices, counts, answered, shown: Math.min(answered, members), members, spread: shownSpread(counts) };
}

/** Consecutive question days the class has kept up (see classStreak). */
function streakFor(classId, today) {
  const members = memberCount(classId);
  const rows = db.prepare(`
    SELECT d.day AS day, (SELECT COUNT(*) FROM class_daily_answers a WHERE a.daily_id = d.id) AS answered
    FROM class_daily d WHERE d.class_id = ? AND d.day <= ? ORDER BY d.day DESC LIMIT 60
  `).all(classId, today);
  return classStreak(rows.map((r) => ({ day: r.day, answered: r.answered, members })), today);
}

// ---------------------------------------------------------------- the teacher

// The questions around now — the last month and the next two — with how each was
// answered: counts and spread, never names.
classDaily.get("/classes/:id/daily", requireAuth, (req, res) => {
  const cls = teacherClass(req, res);
  if (!cls) return;
  const today = utcToday();
  const rows = db.prepare("SELECT * FROM class_daily WHERE class_id = ? AND day >= ? AND day <= ? ORDER BY day DESC")
    .all(cls.id, addDays(today, -30), addDays(today, 62));
  const members = memberCount(cls.id);
  res.json({
    today,
    members,
    items: rows.map((q) => {
      const s = answerStats(q, members);
      return {
        id: q.id, day: q.day, prompt: q.prompt, choices: s.choices, answer: q.answer, explanation: q.explanation,
        answered: s.shown, members, spread: s.spread,
      };
    }),
  });
});

// Write (or rewrite) the question for a day. Once someone has answered it the
// question is fixed — changing it under them would make their answer meaningless.
classDaily.put("/classes/:id/daily", requireAuth, (req, res) => {
  const cls = teacherClass(req, res);
  if (!cls) return;
  const checked = validateDaily(req.body, utcToday());
  if (checked.error) return fail(res, 400, checked.error);
  const v = checked.value;

  const existing = db.prepare("SELECT * FROM class_daily WHERE class_id = ? AND day = ?").get(cls.id, v.day);
  if (existing) {
    if (answerStats(existing).answered > 0) return fail(res, 409, "Someone has already answered that day's question.");
    db.prepare("UPDATE class_daily SET prompt = ?, choices = ?, answer = ?, explanation = ? WHERE id = ?")
      .run(v.prompt, JSON.stringify(v.choices), v.answer, v.explanation, existing.id);
    return res.json({ id: existing.id });
  }

  const total = db.prepare("SELECT COUNT(*) AS n FROM class_daily WHERE class_id = ?").get(cls.id).n;
  if (total >= MAX_QUESTIONS_PER_CLASS) return fail(res, 400, "This class has too many questions. Delete some old ones.");
  const id = crypto.randomUUID();
  try {
    db.prepare("INSERT INTO class_daily (id, class_id, day, prompt, choices, answer, explanation, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, cls.id, v.day, v.prompt, JSON.stringify(v.choices), v.answer, v.explanation, Date.now());
  } catch (e) {
    if (isUniqueViolation(e)) return fail(res, 409, "That day already has a question.");   // two tabs racing
    throw e;
  }
  res.json({ id });
});

classDaily.delete("/classes/:id/daily/:dailyId", requireAuth, (req, res) => {
  const cls = teacherClass(req, res);
  if (!cls) return;
  db.prepare("DELETE FROM class_daily WHERE id = ? AND class_id = ?").run(req.params.dailyId, cls.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- the student

/** What the student may see. The right answer only comes back once they've
 *  answered — never with the question. */
function studentView(q, cls, userId, today) {
  const stats = answerStats(q);
  const mine = db.prepare("SELECT choice FROM class_daily_answers WHERE daily_id = ? AND student_user_id = ?").get(q.id, userId);
  return {
    id: q.id, classId: cls.id, className: cls.name, day: q.day, prompt: q.prompt, choices: stats.choices,
    participation: { answered: stats.shown, members: stats.members },
    streak: streakFor(cls.id, today),
    result: mine ? reveal(q, stats, mine.choice) : null,
  };
}

function reveal(q, stats, choice) {
  return {
    choice, correct: choice === q.answer, answer: q.answer, explanation: q.explanation,
    spread: stats.spread, answered: stats.shown, members: stats.members,
  };
}

// Today's question for every class the student is in. `day` is the student's own
// calendar day (they may be in a different timezone from the server), but never
// more than a day ahead of the server's.
classDaily.get("/my-daily", requireAuth, (req, res) => {
  const day = String(req.query.day || "");
  if (!validDay(day) || day > addDays(utcToday(), 1)) return fail(res, 400, "That date isn't valid.");
  const classes = db.prepare(`
    SELECT c.* FROM class_members m JOIN classes c ON c.id = m.class_id
    WHERE m.student_user_id = ? ORDER BY m.joined_at
  `).all(req.user.userId);
  const items = [];
  for (const cls of classes) {
    const q = db.prepare("SELECT * FROM class_daily WHERE class_id = ? AND day = ?").get(cls.id, day);
    if (q) items.push(studentView(q, cls, req.user.userId, day));
  }
  res.json({ day, items });
});

classDaily.post("/my-daily/:dailyId/answer", requireAuth, (req, res) => {
  // Membership is part of the lookup: a question from a class you're not in doesn't exist for you.
  const q = db.prepare(`
    SELECT d.* FROM class_daily d
    JOIN class_members m ON m.class_id = d.class_id AND m.student_user_id = ?
    WHERE d.id = ?
  `).get(req.user.userId, req.params.dailyId);
  if (!q) return fail(res, 404, "Not found.");
  if (q.day > addDays(utcToday(), 1)) return fail(res, 403, "That question isn't open yet.");

  const nChoices = JSON.parse(q.choices).length;
  const choice = req.body?.choice;
  if (!Number.isInteger(choice) || choice < 0 || choice >= nChoices) return fail(res, 400, "Pick one of the options.");

  try {
    db.prepare("INSERT INTO class_daily_answers (daily_id, student_user_id, choice, answered_at) VALUES (?, ?, ?, ?)")
      .run(q.id, req.user.userId, choice, Date.now());
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const first = db.prepare("SELECT choice FROM class_daily_answers WHERE daily_id = ? AND student_user_id = ?").get(q.id, req.user.userId);
    return res.status(409).json({ error: { message: "You've already answered this one." }, result: reveal(q, answerStats(q), first.choice) });
  }
  res.json({ result: reveal(q, answerStats(q), choice), streak: streakFor(q.class_id, q.day) });
});

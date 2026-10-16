import { Router } from "express";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireActiveLink } from "../middleware/requireActiveLink.js";
import { parentViewOf } from "../parent-view.js";

export const parent = Router();

// Read-only: the part of a linked student's synced state the parent dashboard draws, cut down to what the
// same pure mastery/streak functions need (parent-view.js) - never the sets' questions, answers or notes.
parent.get(
  "/parent/students/:studentUserId/state",
  requireAuth,
  requireActiveLink((req) => req.params.studentUserId),
  (req, res) => {
    const row = db.prepare("SELECT blob FROM state_blobs WHERE user_id = ?").get(req.params.studentUserId);
    res.json({ blob: row ? parentViewOf(JSON.parse(row.blob)) : null });
  }
);

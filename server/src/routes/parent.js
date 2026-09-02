import { Router } from "express";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireActiveLink } from "../middleware/requireActiveLink.js";

export const parent = Router();

// Read-only: a linked student's synced state, for the parent dashboard to run
// the same pure mastery/streak functions the student's own #/progress uses.
parent.get(
  "/parent/students/:studentUserId/state",
  requireAuth,
  requireActiveLink((req) => req.params.studentUserId),
  (req, res) => {
    const row = db.prepare("SELECT blob FROM state_blobs WHERE user_id = ?").get(req.params.studentUserId);
    res.json({ blob: row ? JSON.parse(row.blob) : null });
  }
);

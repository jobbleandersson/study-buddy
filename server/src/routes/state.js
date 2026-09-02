import { Router } from "express";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const state = Router();

// The client's whole store.state blob, synced as one versioned unit — see
// js/store.js's migrate() seam. Optimistic concurrency: a PUT must name the
// version it's updating; a stale version gets a 409 with the current blob
// so the client can surface "updated elsewhere" (last-write-wins, no merge).

state.get("/state", requireAuth, (req, res) => {
  const row = db.prepare("SELECT version, blob FROM state_blobs WHERE user_id = ?").get(req.user.userId);
  if (!row) return res.json({ version: 0, blob: null });
  res.json({ version: row.version, blob: JSON.parse(row.blob) });
});

state.put("/state", requireAuth, (req, res) => {
  const { version, blob } = req.body || {};
  if (!Number.isInteger(version) || typeof blob !== "object" || blob === null) {
    return res.status(400).json({ error: { message: "version (integer) and blob (object) are required." } });
  }

  const current = db.prepare("SELECT version, blob FROM state_blobs WHERE user_id = ?").get(req.user.userId);
  const currentVersion = current?.version ?? 0;
  if (version !== currentVersion) {
    return res.status(409).json({
      error: { message: "State was updated elsewhere." },
      version: currentVersion,
      blob: current ? JSON.parse(current.blob) : null,
    });
  }

  const newVersion = currentVersion + 1;
  db.prepare(`
    INSERT INTO state_blobs (user_id, version, blob, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET version = excluded.version, blob = excluded.blob, updated_at = excluded.updated_at
  `).run(req.user.userId, newVersion, JSON.stringify(blob), Date.now());

  res.json({ version: newVersion });
});

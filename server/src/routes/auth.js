import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { COOKIE_NAME } from "../constants.js";

export const auth = Router();

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function cookieOpts() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    maxAge: SESSION_TTL_MS,
    path: "/",
  };
}

function createSession(res, userId) {
  const id = crypto.randomUUID();
  const now = Date.now();
  db.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(id, userId, now + SESSION_TTL_MS, now);
  res.cookie(COOKIE_NAME, id, cookieOpts());
}

auth.post("/auth/signup", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!email || !email.includes("@")) return res.status(400).json({ error: { message: "Enter a valid email." } });
  if (password.length < 8) return res.status(400).json({ error: { message: "Password must be at least 8 characters." } });

  if (db.prepare("SELECT id FROM users WHERE email = ?").get(email)) {
    return res.status(409).json({ error: { message: "An account with that email already exists." } });
  }

  const id = crypto.randomUUID();
  const hash = await bcrypt.hash(password, 10);
  db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
    .run(id, email, hash, Date.now());

  createSession(res, id);
  res.json({ email });
});

auth.post("/auth/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  const user = db.prepare("SELECT id, password_hash FROM users WHERE email = ?").get(email);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: { message: "Wrong email or password." } });
  }

  createSession(res, user.id);
  res.json({ email });
});

auth.post("/auth/logout", (req, res) => {
  const sid = req.cookies?.[COOKIE_NAME];
  if (sid) db.prepare("DELETE FROM sessions WHERE id = ?").run(sid);
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
});

auth.get("/auth/me", requireAuth, (req, res) => {
  res.json({ email: req.user.email });
});

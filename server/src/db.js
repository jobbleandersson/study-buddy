import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "studybuddy.sqlite3");

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- One row per user: the same versioned JSON blob store.js already keeps in
  -- localStorage, so migrate() runs identically whether it came from disk or here.
  CREATE TABLE IF NOT EXISTS state_blobs (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    version INTEGER NOT NULL DEFAULT 0,
    blob TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  -- No role column: a user can be a parent of one account and a student of
  -- their own, so the relationship alone (not a fixed role) captures it.
  CREATE TABLE IF NOT EXISTS links (
    id TEXT PRIMARY KEY,
    parent_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    student_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    UNIQUE(parent_user_id, student_user_id)
  );

  CREATE TABLE IF NOT EXISTS invite_codes (
    id TEXT PRIMARY KEY,
    student_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code TEXT UNIQUE NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    created_at INTEGER NOT NULL
  );

  -- A set a parent assigned to a student, waiting to be imported. Kept
  -- outside state_blobs entirely so it never touches the version-checked
  -- sync path — the student's own addAssignmentDoc() consumes it directly.
  CREATE TABLE IF NOT EXISTS assigned_sets (
    id TEXT PRIMARY KEY,
    student_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doc TEXT NOT NULL,
    due_at INTEGER,
    created_at INTEGER NOT NULL
  );
`);

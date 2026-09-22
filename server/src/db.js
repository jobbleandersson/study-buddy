import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// On a hosting platform the normal filesystem is wiped on every deploy, so the
// database must live on a mounted persistent disk. Set DB_PATH to a file on
// that disk (e.g. /data/studybuddy.sqlite3); left unset it falls back to the
// old location beside server/, which is right for local development.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "studybuddy.sqlite3");

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
// Off by default per connection — every ON DELETE CASCADE below is inert until this is set. Found
// missing after account deletion (routes/account.js) left orphaned class_daily_answers rows behind:
// its explicit delete list predates that table, and with no cascade to fall back on, nothing else
// cleaned them up either. This doesn't fix that list — a delete people rely on for their privacy
// still shouldn't depend on a pragma, so account.js keeps its own explicit deletes — but it makes
// the schema's own cascades real, as a backstop for the next table someone adds and forgets there.
db.pragma("foreign_keys = ON");

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

  -- Friendship is mutual, unlike a parent/student link — so unlike "links"
  -- above there's no fixed direction. One row per pair under a canonical
  -- ordering (user_a_id always the lexically smaller id), so it can be
  -- queried with a single OR clause instead of one row per direction.
  CREATE TABLE IF NOT EXISTS friend_links (
    id TEXT PRIMARY KEY,
    user_a_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    UNIQUE(user_a_id, user_b_id)
  );

  -- Same shape as invite_codes, kept separate: a code means something
  -- different in each flow (a directional parent/student link there, a
  -- mutual friendship here), so mixing them risked a code from one flow
  -- being redeemable in the other.
  CREATE TABLE IF NOT EXISTS friend_codes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code TEXT UNIQUE NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    created_at INTEGER NOT NULL
  );

  -- One row per user per calendar month: Claude token spend through the
  -- /api/messages proxy. "period" is "YYYY-MM" (UTC). Drives the per-user
  -- monthly budget check and the usage line in Settings. Not tied to a
  -- subscription yet — that arrives with entitlements (Phase 2).
  CREATE TABLE IF NOT EXISTS ai_usage (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    period TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    request_count INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, period)
  );

  -- One row per UTC day for the whole server: estimated Claude spend, in
  -- millionths of a dollar. Drives the daily spend cap (see usage.js).
  CREATE TABLE IF NOT EXISTS ai_spend_daily (
    day TEXT PRIMARY KEY,
    cost_micro INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    request_count INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );

  -- Class mode. Like parent/student links there's no teacher role: whoever
  -- creates a class teaches it. A class has a standing join code (unlike the
  -- short-lived invite codes above) so a whole room can join from one slide.
  -- Joining is the students' consent for their teacher to see how they do on
  -- the sets assigned to the class — and only those (see class-stats.js).
  CREATE TABLE IF NOT EXISTS classes (
    id TEXT PRIMARY KEY,
    teacher_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS class_members (
    class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    student_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (class_id, student_user_id)
  );

  -- A ready-made library set given to the whole class. due_at is a
  -- "YYYY-MM-DD" day, same as a student's own deadlines, or NULL.
  CREATE TABLE IF NOT EXISTS class_assignments (
    id TEXT PRIMARY KEY,
    class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    set_id TEXT NOT NULL,
    due_at TEXT,
    created_at INTEGER NOT NULL
  );

  -- Dagens fråga: at most one multiple-choice question per class per day, written
  -- by the teacher. day is a "YYYY-MM-DD" calendar day. A student answers once;
  -- the row is what enforces that. The teacher only ever gets counts back — see
  -- class-daily.js — never which student chose what.
  CREATE TABLE IF NOT EXISTS class_daily (
    id TEXT PRIMARY KEY,
    class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    prompt TEXT NOT NULL,
    choices TEXT NOT NULL,            -- JSON array of strings
    answer INTEGER NOT NULL,          -- index into choices
    explanation TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    UNIQUE (class_id, day)
  );

  CREATE TABLE IF NOT EXISTS class_daily_answers (
    daily_id TEXT NOT NULL REFERENCES class_daily(id) ON DELETE CASCADE,
    student_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    choice INTEGER NOT NULL,
    answered_at INTEGER NOT NULL,
    PRIMARY KEY (daily_id, student_user_id)
  );
`);

// Sign in with Google: the Google account's stable id ("sub"), on the same user
// row as the email. Added after the fact so it works on a database that already
// holds accounts. SQLite can't add a UNIQUE column in place, so uniqueness is a
// separate partial index (many users have no Google account, i.e. NULL).
if (!db.prepare("PRAGMA table_info(users)").all().some((c) => c.name === "google_sub")) {
  db.exec("ALTER TABLE users ADD COLUMN google_sub TEXT");
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL");

// When someone accepted the Terms and confirmed their age at signup, and which version of the
// terms that was — evidence of consent. NULL for accounts made before the checkbox existed.
for (const [col, type] of [["consent_at", "INTEGER"], ["terms_version", "TEXT"]]) {
  if (!db.prepare("PRAGMA table_info(users)").all().some((c) => c.name === col)) {
    db.exec(`ALTER TABLE users ADD COLUMN ${col} ${type}`);
  }
}

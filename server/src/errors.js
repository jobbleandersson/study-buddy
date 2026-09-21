// True when a write failed on a UNIQUE / PRIMARY KEY constraint. better-sqlite3
// reports it as code SQLITE_CONSTRAINT_UNIQUE (or _PRIMARYKEY); the message
// check keeps it working whichever SQLite binding is underneath.
export function isUniqueViolation(e) {
  const code = String(e?.code || "");
  return code === "SQLITE_CONSTRAINT_UNIQUE"
    || code === "SQLITE_CONSTRAINT_PRIMARYKEY"
    || /UNIQUE constraint failed/i.test(String(e?.message || ""));
}

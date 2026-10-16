// True when a write failed on a UNIQUE / PRIMARY KEY constraint. better-sqlite3
// reports it as code SQLITE_CONSTRAINT_UNIQUE (or _PRIMARYKEY); the message
// check keeps it working whichever SQLite binding is underneath.
export function isUniqueViolation(e) {
  const code = String(e?.code || "");
  return code === "SQLITE_CONSTRAINT_UNIQUE"
    || code === "SQLITE_CONSTRAINT_PRIMARYKEY"
    || /UNIQUE constraint failed/i.test(String(e?.message || ""));
}

// True when the visitor's connection went away while we were answering (a bot that probes for a file and
// hangs up, a phone that lost signal). Express reports that as an error ("Request aborted", code
// ECONNABORTED) but there is nothing wrong with the server and nobody to answer, so it is neither logged as
// a fault nor mailed to the owner.
export function isClientHangup(e) {
  const code = String(e?.code || "");
  return code === "ECONNABORTED" || code === "ECONNRESET" || code === "EPIPE" || e?.type === "request.aborted";
}

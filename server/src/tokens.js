// Secrets that stand for a person are stored hashed: sign-in session ids (the cookie) and the tokens in
// verify, reset and change-of-address links. The browser or the mail holds the real value; the database only
// a SHA-256 of it. A copy of the database (the nightly backup, kept 30 days) then can't be replayed as live
// sessions or links: whoever holds it can't work back to a value the server would accept.
//
// SHA-256 without a salt or a slow hash is right here, unlike for passwords: every value is 32 random bytes
// (or a random UUID), so there is nothing to guess and nothing a precomputed table would contain.

import crypto from "node:crypto";

/** The stored form of a session id or link token. */
export const hashToken = (raw) => crypto.createHash("sha256").update(String(raw)).digest("hex");

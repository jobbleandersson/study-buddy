import crypto from "node:crypto";
import { db } from "./db.js";
import { consume } from "./middleware/attemptLimit.js";
import { isUniqueViolation } from "./errors.js";

// The short codes one person hands to another: a student's code for a parent or teacher
// (invite_codes), a friend code (friend_codes). Both work the same way, so they are issued here.
// The same person can also hand over a link instead of a code (invite_links, friend_invite_links): a long random
// token in a web address, good for a day, for when reading six characters out loud is the awkward part.
//
// One account used to be able to ask for a new code as often as it liked, and every ask wrote a row
// (about 1,300 a second on a laptop, 166 bytes each, and the clean-up only ran hourly): a loop of
// requests from one signed-in student could fill the 1 GB disk that holds everybody's study data.
// Now:
//   - a code that is still unused and has not expired is given out again instead of writing another
//     (what the student sees when they reopen the dialog is the same code, with the same expiry);
//   - a genuinely new code, once the last one is used or has expired, is limited per account
//     (CODES_PER_HOUR_PER_USER, default 10; 0 switches it off).

export const CODE_TTL_MS = 30 * 60 * 1000;   // 30 minutes
// A link is not read out, it is sent in a message and opened later, so it lives longer than a code. It is still
// single-use, and whoever opens it first is shown who is inviting them and has to confirm.
export const LINK_TTL_MS = 24 * 60 * 60 * 1000;

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // ambiguous characters (0/O, 1/I) left out

export function randomCode() {
  let out = "";
  for (let i = 0; i < 6; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

/** A link's secret: 144 random bits as 24 URL-safe characters. Too long to guess, unlike a six-character code. */
export const randomToken = () => crypto.randomBytes(18).toString("base64url");

// Table and column names are fixed here, never taken from a request. `code` is the column that holds the
// secret in every one of these tables (for a link it is the token).
const KINDS = {
  invite: { table: "invite_codes", owner: "student_user_id", ttl: CODE_TTL_MS, make: randomCode },
  inviteLink: { table: "invite_links", owner: "student_user_id", ttl: LINK_TTL_MS, make: randomToken },
  friend: { table: "friend_codes", owner: "user_id", ttl: CODE_TTL_MS, make: randomCode },
  friendLink: { table: "friend_invite_links", owner: "user_id", ttl: LINK_TTL_MS, make: randomToken },
};

const perHour = () => {
  const raw = process.env.CODES_PER_HOUR_PER_USER;
  const n = Number(raw);
  return raw != null && raw.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : 10;
};

/** The owner's code for this kind: their live one if they have it, else a new one.
 *  Returns { code, expiresAt }, or null when the owner has asked for too many new ones. */
export function issueCode(kind, ownerId) {
  const { table, owner, ttl, make } = KINDS[kind];
  const now = Date.now();
  const live = db.prepare(
    `SELECT code, expires_at AS expiresAt FROM ${table} WHERE ${owner} = ? AND used_at IS NULL AND expires_at > ? ORDER BY expires_at DESC LIMIT 1`
  ).get(ownerId, now);
  if (live) return { code: live.code, expiresAt: live.expiresAt };

  if (!consume({ name: `new-${kind}-code`, key: ownerId, max: perHour(), windowMs: 60 * 60 * 1000 })) return null;

  const insert = db.prepare(`INSERT INTO ${table} (id, ${owner}, code, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`);
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = make();
    try {
      insert.run(crypto.randomUUID(), ownerId, code, now + ttl, now);
      return { code, expiresAt: now + ttl };
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;   // a clash with someone else's code: pick another
    }
  }
  throw new Error("could not find a free code");
}

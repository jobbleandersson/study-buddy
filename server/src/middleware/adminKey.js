import crypto from "node:crypto";
import { attemptLimit } from "./attemptLimit.js";

// The admin pages (#/admin/reviews, #/admin/errors) share one key rather than an account role: there
// are no roles in this schema (see the comment on "links" in db.js), and an email allowlist would hand
// the role to whoever registers that address first while email verification is off. Set it with
// `fly secrets set REVIEW_ADMIN_KEY=...` (the name predates the error list); unset, every admin
// endpoint answers 404 as if it didn't exist.

// Only wrong keys count, per address: 10 guesses per 15 minutes, across all admin endpoints.
export const adminFailures = attemptLimit({
  name: "review-admin-fail", max: Number(process.env.REVIEW_ADMIN_FAILS_PER_15MIN_PER_IP ?? 10), windowMs: 15 * 60_000,
  failureStatuses: [403],
});

export function requireAdminKey(req, res, next) {
  const wanted = process.env.REVIEW_ADMIN_KEY || "";
  if (!wanted) return res.status(404).json({ error: { message: "Not found." } });
  const given = Buffer.from(String(req.headers["x-admin-key"] || ""));
  const want = Buffer.from(wanted);
  if (given.length === want.length && crypto.timingSafeEqual(given, want)) return next();
  return res.status(403).json({ error: { message: "Wrong admin key.", code: "admin_key" } });
}

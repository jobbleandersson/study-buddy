// Invite-only mode, for while the site is private. INVITE_EMAILS is a comma-separated list of the
// addresses allowed in; with it set, nobody else can create an account, sign in, or use a session
// they already had (requireAuth and /auth/me treat them as signed out). Unset = open to everyone.
// The list is a secret (`fly secrets set INVITE_EMAILS=...`), not code, so the addresses aren't in git.

const list = () => (process.env.INVITE_EMAILS || "")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

export const inviteOnly = () => list().length > 0;

export const invited = (email) => !inviteOnly() || list().includes(String(email || "").trim().toLowerCase());

export const notInvited = (res) =>
  res.status(403).json({ error: { message: "PluggEra is invite-only right now.", code: "not_invited" } });

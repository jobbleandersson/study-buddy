import { consume, clientKey } from "./middleware/attemptLimit.js";

// Who may be sent a verification or password-reset mail, and how often. These two mails can be triggered
// by anyone without an account (a signup with any address, a forgot-password for any registered one), and
// the mail provider's free tier is 100 a day, so without limits one address could use up the day's budget
// and nobody else would get a verification or reset mail, while strangers received mail they never asked
// for. Beyond the day's budget in email.js (each kind of mail has its own share), each mail is limited per
// recipient and per requesting address:
//
//   MAIL_VERIFY_PER_DAY_PER_ADDRESS (3)   MAIL_RESET_PER_DAY_PER_ADDRESS (3)
//   MAIL_VERIFY_PER_DAY_PER_IP (15)       MAIL_RESET_PER_DAY_PER_IP (10)
//
// 0 switches a limit off. The per-IP figures are meant to cover a class signing up together from one
// school network (15 verification mails) while stopping a script from one machine.

const DAY = 24 * 60 * 60 * 1000;
const num = (name, fallback) => {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const KINDS = {
  verify: { addr: ["MAIL_VERIFY_PER_DAY_PER_ADDRESS", 3], ip: ["MAIL_VERIFY_PER_DAY_PER_IP", 15] },
  reset: { addr: ["MAIL_RESET_PER_DAY_PER_ADDRESS", 3], ip: ["MAIL_RESET_PER_DAY_PER_IP", 10] },
};

/** May this mail go out? Counts it against the recipient's and the requester's allowance if so.
 *  `kind` is "verify" or "reset"; `req` is the request that triggered it (for its address). */
export function mayMail(kind, to, req) {
  const k = KINDS[kind];
  const address = String(to || "").trim().toLowerCase();
  if (!consume({ name: `mail-${kind}-addr`, key: address, max: num(...k.addr), windowMs: DAY })) return false;
  return consume({ name: `mail-${kind}-ip`, key: clientKey(req), max: num(...k.ip), windowMs: DAY });
}

import { consume, TOO_MANY_MESSAGE } from "./attemptLimit.js";

// How often one account may save its study state (PUT /api/state), checked BEFORE the 10 MB JSON body
// is read: reading and storing a big state is the most expensive thing a signed-in student can ask the
// single server process to do, and every other request waits behind it. A real client saves a few times
// a minute (a short pause after each change), so these only ever stop scripts and loops.
//
//   STATE_SAVES_PER_MIN_PER_USER    how many saves per minute (default 30)
//   STATE_BIG_MB_PER_5MIN_PER_USER  megabytes of body over 1 MB per five minutes (default 40: about
//                                   five saves of 8 MB). Small states never touch this limit.
//   STATE_BIG_MB_PER_MIN_ALL        the same megabytes, summed over EVERYONE, per minute (default 100:
//                                   about 12 saves of 8 MB, some five seconds of work a minute). One
//                                   person with many accounts cannot add up to more than this.
// 0 switches a limit off.

const num = (name, fallback) => {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const MIN = 60_000;
const MB = 1_000_000;
const BIG_BODY = 1 * MB;
const MAX_BODY = 10 * MB;   // what express.json accepts for this route (index.js)

/** Middleware for PUT /api/state; needs req.user, so it runs after requireAuth. */
export function stateSaveLimit(req, res, next) {
  const key = req.user?.userId;
  const refuse = () => {
    res.set("Retry-After", "60");
    res.status(429).json({ error: { message: TOO_MANY_MESSAGE, code: "too_many_saves" } });
  };
  if (!consume({ name: "state-save", key, max: num("STATE_SAVES_PER_MIN_PER_USER", 30), windowMs: MIN })) return refuse();

  // A missing or odd Content-Length counts as the largest body the route accepts.
  const declared = Number(req.headers["content-length"]);
  const bytes = Number.isFinite(declared) && declared >= 0 ? declared : MAX_BODY;
  if (bytes > BIG_BODY) {
    const units = Math.min(10, Math.ceil(bytes / MB));
    const max = num("STATE_BIG_MB_PER_5MIN_PER_USER", 40);
    const maxAll = num("STATE_BIG_MB_PER_MIN_ALL", 100);
    for (let i = 0; i < units; i++) {
      if (!consume({ name: "state-save-mb", key, max, windowMs: 5 * MIN })) return refuse();
      if (!consume({ name: "state-save-mb-all", key: "everyone", max: maxAll, windowMs: MIN })) return refuse();
    }
  }
  next();
}

// Sliding-window "too many attempts" limiter for the endpoints that hand out
// accounts or let someone guess a code. In memory and per-process, like
// rateLimit.js: right for the single Fly machine this runs on, and it starts
// over on a restart. A blocked request gets a 429 in the same
// {error:{message}} shape as everything else, plus Retry-After.
//
// Two ways to count:
//   default          every request counts (signup: each one makes an account)
//   failureStatuses  only responses with one of these statuses count, so a
//                    whole class logging in or joining from one school IP is
//                    not punished for the attempts that work
//
// The default key is the client's IP (see clientIp for where it comes from). An
// IPv6 address is cut down to its /64: one connection can use billions of
// addresses in that block, and would otherwise get a fresh allowance for each.

export const TOO_MANY_MESSAGE = "Too many attempts. Try again in a few minutes.";

const MAX_KEYS = 100_000;
const buckets = new Map(); // "name|key" -> { hits: [ms, …], windowMs }

// Keep the map from growing without bound on a long-lived process.
setInterval(() => {
  const now = Date.now();
  for (const [id, b] of buckets) {
    while (b.hits.length && b.hits[0] <= now - b.windowMs) b.hits.shift();
    if (!b.hits.length) buckets.delete(id);
  }
}, 5 * 60_000).unref?.();

/** IPv4 as is, IPv4-in-IPv6 as IPv4, other IPv6 as its /64 prefix. */
export function ipKey(ip) {
  if (!ip) return "";
  if (ip.startsWith("::ffff:") && ip.includes(".")) return ip.slice(7);
  if (!ip.includes(":")) return ip;
  const [head, tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const gap = ip.includes("::") ? Array(Math.max(0, 8 - h.length - t.length)).fill("0") : [];
  return [...h, ...gap, ...t].slice(0, 4).join(":") + "::/64";
}

/** The client's address. On Fly the proxy puts it in Fly-Client-IP; the last entry
 *  of X-Forwarded-For there is the app's own shared address (Fly's docs), so Express's
 *  req.ip would be the same for every visitor. Anywhere else nothing sets that header
 *  and a client could forge it, so it is only read when FLY_APP_NAME says we're on Fly. */
export function clientIp(req) {
  const fly = process.env.FLY_APP_NAME ? req.headers?.["fly-client-ip"] : null;
  return fly ? String(fly).trim() : req.ip;
}

/** The default limiter key: the client's address, IPv6 cut to its /64. */
export const clientKey = (req) => ipKey(clientIp(req));

/**
 * name: bucket namespace (limiters with the same name share a count).
 * max: attempts allowed per window; 0 or less turns the limit off.
 */
export function attemptLimit({ name, max, windowMs, key = clientKey, failureStatuses = null }) {
  return (req, res, next) => {
    const k = key(req);
    if (!(max > 0) || !k) return next();
    const id = `${name}|${k}`;

    const now = Date.now();
    const bucket = buckets.get(id);
    if (bucket) {
      while (bucket.hits.length && bucket.hits[0] <= now - windowMs) bucket.hits.shift();
      if (bucket.hits.length >= max) {
        const retryAfter = Math.max(1, Math.ceil((bucket.hits[0] + windowMs - now) / 1000));
        res.set("Retry-After", String(retryAfter));
        return res.status(429).json({ error: { message: TOO_MANY_MESSAGE, code: "rate_limited" } });
      }
    }

    const record = () => {
      let b = buckets.get(id);
      if (!b) {
        if (buckets.size >= MAX_KEYS) return;   // a flood of distinct keys: stop tracking new ones rather than grow
        b = { hits: [], windowMs };
        buckets.set(id, b);
      }
      b.hits.push(Date.now());
    };

    // "close", not "finish": finish never fires when the client has already hung up,
    // and a guess whose sender walks away is still a guess the server evaluated.
    if (failureStatuses) res.on("close", () => { if (failureStatuses.includes(res.statusCode)) record(); });
    else record();
    next();
  };
}

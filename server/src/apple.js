// Verifies a "Sign in with Apple" identity token (a signed JWT) with no dependencies: the same checks
// google.js makes, against Apple's keys. It must be signed by Apple, issued by https://appleid.apple.com,
// for one of our client ids, not expired, and carry an email Apple has verified. Someone may hide their
// address behind an Apple relay one (…@privaterelay.appleid.com); that is then the account's email, and
// mail to it reaches them.
//
// Client ids: APPLE_CLIENT_ID is the website's Services ID (the one the web button uses, and the one
// /api/health hands the browser); APPLE_EXTRA_AUDIENCES, comma-separated, adds more that tokens may be
// issued for - the iOS app's bundle id, once there is an app. Unset = Sign in with Apple is off.

const subtle = globalThis.crypto?.subtle ?? (await import("node:crypto")).webcrypto.subtle;

// Tests serve their own keys (server/test/apple.test.mjs); never overridable outside NODE_ENV=test.
const JWKS_URL = (process.env.NODE_ENV === "test" && process.env.APPLE_JWKS_URL) || "https://appleid.apple.com/auth/keys";
const ISSUER = "https://appleid.apple.com";
const CLOCK_SKEW_S = 60;
const KEY_REFETCH_MIN_MS = 60_000;   // never hammer Apple because of junk tokens

export class AppleTokenError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

/** The client ids an Apple token may be issued for (see the top); empty = not set up. */
export function appleClientIds() {
  return [process.env.APPLE_CLIENT_ID, ...String(process.env.APPLE_EXTRA_AUDIENCES || "").split(",")]
    .map((s) => String(s || "").trim()).filter(Boolean);
}

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
function parseJsonPart(s) {
  try { return JSON.parse(new TextDecoder().decode(b64urlToBytes(s))); }
  catch { throw new AppleTokenError("malformed"); }
}

// ---- Apple's public signing keys, cached ------------------------------------
let keyCache = { byKid: new Map(), fetchedAt: 0, expiresAt: 0 };

async function fetchAppleKeys() {
  let res;
  try { res = await fetch(JWKS_URL); } catch { throw new AppleTokenError("keys_unavailable"); }
  if (!res.ok) throw new AppleTokenError("keys_unavailable");
  const { keys } = await res.json();
  const maxAge = /max-age=(\d+)/.exec(res.headers.get("cache-control") || "")?.[1];
  const now = Date.now();
  keyCache = {
    byKid: new Map((keys || []).map((k) => [k.kid, k])),
    fetchedAt: now,
    expiresAt: now + (maxAge ? Number(maxAge) * 1000 : 3_600_000),
  };
}

/** The default key lookup: from cache, refreshed when stale or when an unknown key id shows up (Apple
 *  rotates keys) - but at most once a minute. */
export async function appleJwk(kid) {
  const now = Date.now();
  const stale = now > keyCache.expiresAt;
  const unknown = !keyCache.byKid.has(kid);
  if ((stale || unknown) && now - keyCache.fetchedAt > KEY_REFETCH_MIN_MS) await fetchAppleKeys();
  return keyCache.byKid.get(kid) || null;
}

/** Returns { sub, email } for a valid token, or throws AppleTokenError with a short `code`:
 *  not_configured | malformed | bad_alg | unknown_key | bad_signature | bad_issuer | bad_audience |
 *  expired | not_yet_valid | no_subject | no_email | email_unverified | keys_unavailable.
 *  `getJwk` and `now` exist so tests can supply their own key and clock. */
export async function verifyAppleIdToken(token, { clientIds = appleClientIds(), getJwk = appleJwk, now = Date.now } = {}) {
  const ids = (Array.isArray(clientIds) ? clientIds : [clientIds]).filter(Boolean);
  if (!ids.length) throw new AppleTokenError("not_configured");
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts.some((p) => !p)) throw new AppleTokenError("malformed");
  const [h, p, s] = parts;

  const header = parseJsonPart(h);
  if (header.alg !== "RS256") throw new AppleTokenError("bad_alg");   // rejects "none" and HMAC tricks
  const jwk = await getJwk(header.kid);
  if (!jwk) throw new AppleTokenError("unknown_key");

  let ok = false;
  try {
    const key = await subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    ok = await subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`));
  } catch { ok = false; }
  if (!ok) throw new AppleTokenError("bad_signature");

  const c = parseJsonPart(p);
  const nowS = Math.floor(now() / 1000);
  if (c.iss !== ISSUER) throw new AppleTokenError("bad_issuer");
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.some((a) => ids.includes(a))) throw new AppleTokenError("bad_audience");
  if (typeof c.exp !== "number" || c.exp + CLOCK_SKEW_S < nowS) throw new AppleTokenError("expired");
  if (typeof c.nbf === "number" && c.nbf - CLOCK_SKEW_S > nowS) throw new AppleTokenError("not_yet_valid");
  if (typeof c.sub !== "string" || !c.sub) throw new AppleTokenError("no_subject");
  const email = typeof c.email === "string" ? c.email.trim().toLowerCase() : "";
  if (!email.includes("@")) throw new AppleTokenError("no_email");
  if (c.email_verified !== true && c.email_verified !== "true") throw new AppleTokenError("email_unverified");

  return { sub: c.sub, email };
}

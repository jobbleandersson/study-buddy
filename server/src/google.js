// Verifies a "Sign in with Google" ID token (a signed JWT) with no dependencies.
// The browser hands us the token; we check it was really signed by Google, was
// issued for THIS app (audience = our client id), hasn't expired, and carries a
// verified email. Signature checking uses WebCrypto, which exists both in Node 20
// and in browsers — so this file can be unit-tested in a browser tab.

const subtle = globalThis.crypto?.subtle ?? (await import("node:crypto")).webcrypto.subtle;

const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const CLOCK_SKEW_S = 60;
const KEY_REFETCH_MIN_MS = 60_000;   // never hammer Google because of junk tokens

export class GoogleTokenError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
function parseJsonPart(s) {
  try { return JSON.parse(new TextDecoder().decode(b64urlToBytes(s))); }
  catch { throw new GoogleTokenError("malformed"); }
}

// ---- Google's public signing keys, cached ------------------------------------
let keyCache = { byKid: new Map(), fetchedAt: 0, expiresAt: 0 };

async function fetchGoogleKeys() {
  let res;
  try { res = await fetch(JWKS_URL); } catch { throw new GoogleTokenError("keys_unavailable"); }
  if (!res.ok) throw new GoogleTokenError("keys_unavailable");
  const { keys } = await res.json();
  const maxAge = /max-age=(\d+)/.exec(res.headers.get("cache-control") || "")?.[1];
  const now = Date.now();
  keyCache = {
    byKid: new Map((keys || []).map((k) => [k.kid, k])),
    fetchedAt: now,
    expiresAt: now + (maxAge ? Number(maxAge) * 1000 : 3_600_000),
  };
}

/** The default key lookup: from cache, refreshed when stale or when an unknown
 *  key id shows up (Google rotates keys) — but at most once a minute. */
export async function googleJwk(kid) {
  const now = Date.now();
  const stale = now > keyCache.expiresAt;
  const unknown = !keyCache.byKid.has(kid);
  if ((stale || unknown) && now - keyCache.fetchedAt > KEY_REFETCH_MIN_MS) await fetchGoogleKeys();
  return keyCache.byKid.get(kid) || null;
}

/** Returns { sub, email } for a valid token, or throws GoogleTokenError with a
 *  short `code`: malformed | bad_alg | unknown_key | bad_signature | bad_issuer |
 *  bad_audience | expired | not_yet_valid | no_subject | no_email |
 *  email_unverified | keys_unavailable.
 *  `getJwk` and `now` exist so tests can supply their own key and clock. */
export async function verifyGoogleIdToken(credential, { clientId, getJwk = googleJwk, now = Date.now } = {}) {
  if (!clientId) throw new GoogleTokenError("not_configured");
  const parts = String(credential || "").split(".");
  if (parts.length !== 3 || parts.some((p) => !p)) throw new GoogleTokenError("malformed");
  const [h, p, s] = parts;

  const header = parseJsonPart(h);
  if (header.alg !== "RS256") throw new GoogleTokenError("bad_alg");   // rejects "none" and HMAC tricks
  const jwk = await getJwk(header.kid);
  if (!jwk) throw new GoogleTokenError("unknown_key");

  let ok = false;
  try {
    const key = await subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    ok = await subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`));
  } catch { ok = false; }
  if (!ok) throw new GoogleTokenError("bad_signature");

  const c = parseJsonPart(p);
  const nowS = Math.floor(now() / 1000);
  if (!ISSUERS.includes(c.iss)) throw new GoogleTokenError("bad_issuer");
  if (c.aud !== clientId) throw new GoogleTokenError("bad_audience");
  if (typeof c.exp !== "number" || c.exp + CLOCK_SKEW_S < nowS) throw new GoogleTokenError("expired");
  if (typeof c.nbf === "number" && c.nbf - CLOCK_SKEW_S > nowS) throw new GoogleTokenError("not_yet_valid");
  if (typeof c.sub !== "string" || !c.sub) throw new GoogleTokenError("no_subject");
  const email = typeof c.email === "string" ? c.email.trim().toLowerCase() : "";
  if (!email.includes("@")) throw new GoogleTokenError("no_email");
  if (c.email_verified !== true && c.email_verified !== "true") throw new GoogleTokenError("email_unverified");

  return { sub: c.sub, email };
}

// TOTP (RFC 6238) on top of HOTP (RFC 4226) — zero dependencies, node:crypto only. No QR library:
// enrollment shows the base32 secret as text plus an otpauth:// link (see routes/auth.js), which an
// authenticator app can open directly on a phone.

import crypto from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; // RFC 4648 base32, no padding

export function base32Encode(buf) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const bytes = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** 160 bits, the standard size for an HMAC-SHA1-based TOTP secret. */
export function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function counterBuffer(counter) {
  const buf = Buffer.alloc(8);
  let c = BigInt(counter);
  for (let i = 7; i >= 0; i--) {
    buf[i] = Number(c & 0xffn);
    c >>= 8n;
  }
  return buf;
}

/** RFC 4226 HOTP at a given counter, RFC 6238 TOTP's building block. */
export function totpAt(secretBase32, counter, { digits = 6 } = {}) {
  const key = base32Decode(secretBase32);
  const hmac = crypto.createHmac("sha1", key).update(counterBuffer(counter)).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(bin % 10 ** digits).padStart(digits, "0");
}

/** Checks `code` against the current 30s step and one step either side (clock drift). Rejects any
 *  step at or before `afterCounter` so a code already accepted (or one from a step already spent)
 *  can't be replayed. Returns the matched step on success, so the caller can persist it as the new
 *  `afterCounter` for next time. */
export function verifyTotp(secretBase32, code, { afterCounter = 0, step = 30, window = 1, time = Date.now() } = {}) {
  const clean = String(code || "").trim();
  if (!clean) return { ok: false, counter: null };
  const now = Math.floor(time / 1000 / step);
  for (let w = -window; w <= window; w++) {
    const counter = now + w;
    if (counter <= afterCounter) continue;
    if (totpAt(secretBase32, counter, { digits: 6 }) === clean) return { ok: true, counter };
  }
  return { ok: false, counter: null };
}

export function otpauthUri(secretBase32, { email, issuer = "PluggEra" } = {}) {
  const label = `${issuer}:${email}`;
  const params = new URLSearchParams({ secret: secretBase32, issuer, digits: "6", period: "30", algorithm: "SHA1" });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

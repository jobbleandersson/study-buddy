// verifyGoogleIdToken() takes an injectable `getJwk` and `now` (see google.js's
// own doc comment: "so tests can supply their own key and clock") - a real seam,
// so this signs actual JWTs with a throwaway keypair and checks the full
// signature/issuer/audience/expiry pipeline without ever calling Google.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifyGoogleIdToken, GoogleTokenError } from "../src/google.js";

const CLIENT_ID = "test-client-id.apps.googleusercontent.com";
const KID = "test-kid-1";

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const JWK = { ...publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" };
const getJwk = async (kid) => (kid === KID ? JWK : null);

function b64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function signToken({ header = {}, payload = {}, key = privateKey } = {}) {
  const h = b64url(JSON.stringify({ alg: "RS256", kid: KID, ...header }));
  const p = b64url(JSON.stringify(payload));
  const signature = crypto.sign("RSA-SHA256", Buffer.from(`${h}.${p}`), key);
  return `${h}.${p}.${b64url(signature)}`;
}

const nowS = () => Math.floor(Date.now() / 1000);
function validPayload(overrides = {}) {
  return {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    sub: "1234567890",
    email: "student@example.com",
    email_verified: true,
    exp: nowS() + 3600,
    iat: nowS(),
    ...overrides,
  };
}

describe("verifyGoogleIdToken: the happy path", () => {
  test("a well-formed, correctly signed, current token verifies", async () => {
    const token = signToken({ payload: validPayload() });
    const out = await verifyGoogleIdToken(token, { clientId: CLIENT_ID, getJwk });
    assert.deepEqual(out, { sub: "1234567890", email: "student@example.com" });
  });

  test("email is lowercased and trimmed", async () => {
    const token = signToken({ payload: validPayload({ email: "  Student@Example.com  " }) });
    const out = await verifyGoogleIdToken(token, { clientId: CLIENT_ID, getJwk });
    assert.equal(out.email, "student@example.com");
  });

  test("accepts the alternate bare 'accounts.google.com' issuer", async () => {
    const token = signToken({ payload: validPayload({ iss: "accounts.google.com" }) });
    const out = await verifyGoogleIdToken(token, { clientId: CLIENT_ID, getJwk });
    assert.ok(out);
  });

  test("email_verified accepts the string 'true' as well as boolean true", async () => {
    const token = signToken({ payload: validPayload({ email_verified: "true" }) });
    const out = await verifyGoogleIdToken(token, { clientId: CLIENT_ID, getJwk });
    assert.ok(out);
  });

  test("a token issued slightly in the future within clock skew still verifies", async () => {
    const token = signToken({ payload: validPayload({ nbf: nowS() + 30 }) }); // 30s < 60s skew
    const out = await verifyGoogleIdToken(token, { clientId: CLIENT_ID, getJwk });
    assert.ok(out);
  });
});

describe("verifyGoogleIdToken: rejections", () => {
  test("no clientId configured", async () => {
    await assert.rejects(
      verifyGoogleIdToken("whatever", { clientId: "", getJwk }),
      (e) => e instanceof GoogleTokenError && e.code === "not_configured",
    );
  });

  test("not a three-part JWT", async () => {
    await assert.rejects(
      verifyGoogleIdToken("not-a-jwt", { clientId: CLIENT_ID, getJwk }),
      (e) => e.code === "malformed",
    );
  });

  test("empty credential", async () => {
    await assert.rejects(
      verifyGoogleIdToken("", { clientId: CLIENT_ID, getJwk }),
      (e) => e.code === "malformed",
    );
  });

  test("rejects alg:none / non-RS256 algorithms", async () => {
    const token = signToken({ header: { alg: "none" }, payload: validPayload() });
    await assert.rejects(
      verifyGoogleIdToken(token, { clientId: CLIENT_ID, getJwk }),
      (e) => e.code === "bad_alg",
    );
  });

  test("unknown key id", async () => {
    const token = signToken({ header: { kid: "some-other-kid" }, payload: validPayload() });
    await assert.rejects(
      verifyGoogleIdToken(token, { clientId: CLIENT_ID, getJwk }),
      (e) => e.code === "unknown_key",
    );
  });

  test("tampered payload breaks the signature", async () => {
    const token = signToken({ payload: validPayload() });
    const [h, p, s] = token.split(".");
    const tamperedPayload = b64url(JSON.stringify(validPayload({ sub: "attacker-controlled-id" })));
    const tampered = `${h}.${tamperedPayload}.${s}`;
    await assert.rejects(
      verifyGoogleIdToken(tampered, { clientId: CLIENT_ID, getJwk }),
      (e) => e.code === "bad_signature",
    );
  });

  test("signed by a different key than the one on file for that kid", async () => {
    const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const token = signToken({ payload: validPayload(), key: other.privateKey });
    await assert.rejects(
      verifyGoogleIdToken(token, { clientId: CLIENT_ID, getJwk }),
      (e) => e.code === "bad_signature",
    );
  });

  test("wrong issuer", async () => {
    const token = signToken({ payload: validPayload({ iss: "https://evil.example.com" }) });
    await assert.rejects(
      verifyGoogleIdToken(token, { clientId: CLIENT_ID, getJwk }),
      (e) => e.code === "bad_issuer",
    );
  });

  test("wrong audience (token minted for a different client id)", async () => {
    const token = signToken({ payload: validPayload({ aud: "someone-elses-client-id" }) });
    await assert.rejects(
      verifyGoogleIdToken(token, { clientId: CLIENT_ID, getJwk }),
      (e) => e.code === "bad_audience",
    );
  });

  test("expired token", async () => {
    const token = signToken({ payload: validPayload({ exp: nowS() - 3600 }) });
    await assert.rejects(
      verifyGoogleIdToken(token, { clientId: CLIENT_ID, getJwk }),
      (e) => e.code === "expired",
    );
  });

  test("not yet valid (nbf far in the future)", async () => {
    const token = signToken({ payload: validPayload({ nbf: nowS() + 3600 }) });
    await assert.rejects(
      verifyGoogleIdToken(token, { clientId: CLIENT_ID, getJwk }),
      (e) => e.code === "not_yet_valid",
    );
  });

  test("missing subject", async () => {
    const token = signToken({ payload: validPayload({ sub: undefined }) });
    await assert.rejects(
      verifyGoogleIdToken(token, { clientId: CLIENT_ID, getJwk }),
      (e) => e.code === "no_subject",
    );
  });

  test("missing/invalid email", async () => {
    const token = signToken({ payload: validPayload({ email: "not-an-email" }) });
    await assert.rejects(
      verifyGoogleIdToken(token, { clientId: CLIENT_ID, getJwk }),
      (e) => e.code === "no_email",
    );
  });

  test("email present but not verified by Google", async () => {
    const token = signToken({ payload: validPayload({ email_verified: false }) });
    await assert.rejects(
      verifyGoogleIdToken(token, { clientId: CLIENT_ID, getJwk }),
      (e) => e.code === "email_unverified",
    );
  });

  test("Google's key endpoint being unreachable surfaces as keys_unavailable", async () => {
    const token = signToken({ payload: validPayload() });
    const brokenGetJwk = async () => { throw new Error("network down"); };
    await assert.rejects(verifyGoogleIdToken(token, { clientId: CLIENT_ID, getJwk: brokenGetJwk }));
  });
});

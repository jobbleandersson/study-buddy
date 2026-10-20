// Sign in with Apple: verifyAppleIdToken() with a throwaway keypair (no call to Apple), then the
// /api/auth/apple route end to end against a local JWKS server - the same shape as google.test.mjs and
// welcome-email.test.mjs. The route shares providerSignIn() with Google, so a Google sign-in is checked
// here too, to show the shared code still serves it.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { verifyAppleIdToken, AppleTokenError } from "../src/apple.js";
import { totpAt } from "../src/totp.js";
import { startServer, makeClient } from "./harness.mjs";

const APPLE_ID = "se.pluggera.web";
const APP_BUNDLE = "se.pluggera.app";
const GOOGLE_ID = "test-client-id.apps.googleusercontent.com";
const KID = "apple-test-kid";

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const JWK = { ...publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" };
const getJwk = async (kid) => (kid === KID ? JWK : null);

const b64url = (input) => Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function sign(payload, header = {}) {
  const h = b64url(JSON.stringify({ alg: "RS256", kid: KID, ...header }));
  const p = b64url(JSON.stringify(payload));
  return `${h}.${p}.${b64url(crypto.sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey))}`;
}
const nowS = () => Math.floor(Date.now() / 1000);
const applePayload = (o = {}) => ({ iss: "https://appleid.apple.com", aud: APPLE_ID, sub: "000123.apple", email: "elev@example.com", email_verified: "true", iat: nowS(), exp: nowS() + 600, ...o });
const googlePayload = (o = {}) => ({ iss: "https://accounts.google.com", aud: GOOGLE_ID, sub: "g-123", email: "g@example.com", email_verified: true, iat: nowS(), exp: nowS() + 600, ...o });

describe("verifyAppleIdToken", () => {
  const verify = (token, opts = {}) => verifyAppleIdToken(token, { clientIds: [APPLE_ID, APP_BUNDLE], getJwk, ...opts });

  test("a correctly signed, current token verifies; the email is lowercased", async () => {
    const out = await verify(sign(applePayload({ email: " Elev@Example.com " })));
    assert.deepEqual(out, { sub: "000123.apple", email: "elev@example.com" });
  });
  test("a token for the app's bundle id is accepted too (the extra audiences)", async () => {
    assert.ok(await verify(sign(applePayload({ aud: APP_BUNDLE }))));
  });
  test("an Apple relay address is a valid email", async () => {
    const out = await verify(sign(applePayload({ email: "abc123@privaterelay.appleid.com", is_private_email: "true" })));
    assert.equal(out.email, "abc123@privaterelay.appleid.com");
  });
  const rejects = [
    ["not configured", () => verifyAppleIdToken(sign(applePayload()), { clientIds: [], getJwk }), "not_configured"],
    ["not a JWT", () => verify("nope"), "malformed"],
    ["alg none", () => verify(sign(applePayload(), { alg: "none" })), "bad_alg"],
    ["unknown key", () => verify(sign(applePayload(), { kid: "other" })), "unknown_key"],
    ["Google's issuer", () => verify(sign(applePayload({ iss: "https://accounts.google.com" }))), "bad_issuer"],
    ["someone else's app", () => verify(sign(applePayload({ aud: "com.example.other" }))), "bad_audience"],
    ["expired", () => verify(sign(applePayload({ exp: nowS() - 3600 }))), "expired"],
    ["no subject", () => verify(sign(applePayload({ sub: "" }))), "no_subject"],
    ["no email", () => verify(sign(applePayload({ email: undefined }))), "no_email"],
    ["unverified email", () => verify(sign(applePayload({ email_verified: "false" }))), "email_unverified"],
  ];
  for (const [name, run, code] of rejects) {
    test(`rejects: ${name}`, async () => {
      await assert.rejects(run(), (e) => e instanceof AppleTokenError && e.code === code);
    });
  }
  test("a tampered payload breaks the signature", async () => {
    const [h, , s] = sign(applePayload()).split(".");
    const forged = `${h}.${b64url(JSON.stringify(applePayload({ sub: "attacker" })))}.${s}`;
    await assert.rejects(verify(forged), (e) => e.code === "bad_signature");
  });
});

describe("/api/auth/apple", () => {
  let server, jwks;
  before(async () => {
    jwks = http.createServer((req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ keys: [JWK] })); });
    await new Promise((r) => jwks.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${jwks.address().port}/keys`;
    server = await startServer({
      APPLE_CLIENT_ID: APPLE_ID, APPLE_EXTRA_AUDIENCES: APP_BUNDLE, APPLE_JWKS_URL: url,
      GOOGLE_CLIENT_ID: GOOGLE_ID, GOOGLE_JWKS_URL: url,
    });
  });
  after(async () => { await server.stop(); await new Promise((r) => jwks.close(r)); });

  const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  test("a new Apple ID needs the terms yes, then creates a passwordless account", async () => {
    const id = uniq();
    const token = sign(applePayload({ sub: `a-${id}`, email: `new-${id}@example.com` }));
    const c = makeClient(server.baseUrl);
    const first = await c.post("/api/auth/apple", { idToken: token });
    assert.equal(first.status, 400);
    assert.equal(first.json.error.code, "consent_required");
    const made = await c.post("/api/auth/apple", { idToken: token, consent: true });
    assert.equal(made.status, 200, JSON.stringify(made.json));
    assert.equal(made.json.created, true);
    const me = await c.get("/api/auth/me");
    assert.equal(me.json.authed, true);
    assert.equal(me.json.passwordless, true);
    assert.equal(me.json.googleLinked, false);
  });

  test("the same Apple ID signs in to the same account again", async () => {
    const id = uniq();
    const token = sign(applePayload({ sub: `a-${id}`, email: `again-${id}@example.com` }));
    await makeClient(server.baseUrl).post("/api/auth/apple", { idToken: token, consent: true });
    const again = await makeClient(server.baseUrl).post("/api/auth/apple", { idToken: token });
    assert.equal(again.status, 200);
    assert.equal(again.json.created, false);
    assert.equal(again.json.linked, false);
  });

  test("an existing password account with that email is linked, and its password stops working", async () => {
    const id = uniq();
    const email = `link-${id}@example.com`;
    await makeClient(server.baseUrl).post("/api/auth/signup", { email, password: "correctpw1", consent: true });
    const linked = await makeClient(server.baseUrl).post("/api/auth/apple", { idToken: sign(applePayload({ sub: `a-${id}`, email })) });
    assert.equal(linked.status, 200, JSON.stringify(linked.json));
    assert.equal(linked.json.linked, true);
    const pw = await makeClient(server.baseUrl).post("/api/auth/login", { email, password: "correctpw1" });
    assert.equal(pw.status, 401);
  });

  test("an account with two-step sign-in is never linked by Apple alone", async () => {
    const id = uniq();
    const email = `twofa-${id}@example.com`;
    const c = makeClient(server.baseUrl);
    await c.post("/api/auth/signup", { email, password: "correctpw1", consent: true });
    // Turn on app-based two-step sign-in with a code the test computes itself.
    const setup = await c.post("/api/auth/2fa/setup", {});
    const secret = setup.json.secret;
    const on = await c.post("/api/auth/2fa/confirm", { password: "correctpw1", secret, code: totpAt(secret, Math.floor(Date.now() / 1000 / 30)) });
    assert.equal(on.status, 200, JSON.stringify(on.json));
    const r = await makeClient(server.baseUrl).post("/api/auth/apple", { idToken: sign(applePayload({ sub: `a-${id}`, email })) });
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, "apple_link_twofa");
  });

  test("a bad or foreign token is a 401, an unverified email a 403", async () => {
    const c = makeClient(server.baseUrl);
    assert.equal((await c.post("/api/auth/apple", { idToken: "x.y.z" })).status, 401);
    assert.equal((await c.post("/api/auth/apple", { idToken: sign(applePayload({ aud: "com.example.other" })) })).status, 401);
    const unv = await c.post("/api/auth/apple", { idToken: sign(applePayload({ email_verified: "false" })) });
    assert.equal(unv.status, 403);
    assert.equal(unv.json.error.code, "apple_email_unverified");
  });

  test("Google sign-in still works through the shared code", async () => {
    const id = uniq();
    const c = makeClient(server.baseUrl);
    const made = await c.post("/api/auth/google", { credential: sign(googlePayload({ sub: `g-${id}`, email: `g-${id}@example.com` })), consent: true });
    assert.equal(made.status, 200, JSON.stringify(made.json));
    assert.equal(made.json.created, true);
    const me = await c.get("/api/auth/me");
    assert.equal(me.json.passwordless, true);
    assert.equal(me.json.googleLinked, true);
  });

  test("Google and Apple with the same email end up on one account", async () => {
    const id = uniq();
    const email = `both-${id}@example.com`;
    const g = await makeClient(server.baseUrl).post("/api/auth/google", { credential: sign(googlePayload({ sub: `g-${id}`, email })), consent: true });
    assert.equal(g.json.created, true);
    const a = await makeClient(server.baseUrl).post("/api/auth/apple", { idToken: sign(applePayload({ sub: `a-${id}`, email })) });
    assert.equal(a.status, 200, JSON.stringify(a.json));
    assert.equal(a.json.created, false);
    assert.equal(a.json.linked, true);
    const g2 = await makeClient(server.baseUrl).post("/api/auth/google", { credential: sign(googlePayload({ sub: `g-${id}`, email })) });
    assert.equal(g2.json.created, false);
  });
});

describe("/api/auth/apple when it isn't set up", () => {
  let server;
  before(async () => { server = await startServer({ APPLE_CLIENT_ID: "" }); });
  after(async () => { await server.stop(); });
  test("answers 501 apple_not_configured, and /api/health has no client id", async () => {
    const r = await makeClient(server.baseUrl).post("/api/auth/apple", { idToken: "x.y.z" });
    assert.equal(r.status, 501);
    assert.equal(r.json.error.code, "apple_not_configured");
    const h = await makeClient(server.baseUrl).get("/api/health");
    assert.equal(h.json.appleClientId, null);
  });
});

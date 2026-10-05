// The welcome mail: once per new account — after the address is confirmed for an email sign-up,
// straight away for a Google sign-up — and never a second time.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { startServer, startFakeResend, makeClient } from "./harness.mjs";

const CLIENT_ID = "welcome-client-id.apps.googleusercontent.com";
const KID = "welcome-kid";
const PASSWORD = "correctpw1";
const WELCOME = "Välkommen till PluggEra";
const uniqueEmail = (p = "welcome") => `${p}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64url = (x) => Buffer.from(x).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function googleToken({ sub, email }) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64url(JSON.stringify({ alg: "RS256", kid: KID }));
  const p = b64url(JSON.stringify({ iss: "https://accounts.google.com", aud: CLIENT_ID, sub, email, email_verified: true, iat: now, exp: now + 3600 }));
  return `${h}.${p}.${b64url(crypto.sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey))}`;
}

describe("the welcome mail", () => {
  let server, fake, jwks;
  before(async () => {
    fake = await startFakeResend();
    jwks = http.createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" }] }));
    });
    await new Promise((r) => jwks.listen(0, "127.0.0.1", r));
    server = await startServer({
      RESEND_API_KEY: "test-key", RESEND_API_URL: fake.url, PUBLIC_URL: "https://pluggera.example",
      GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_JWKS_URL: `http://127.0.0.1:${jwks.address().port}/certs`,
    });
  });
  after(async () => { await server.stop(); await fake.stop(); await new Promise((r) => jwks.close(r)); });

  // The mails go out without the response waiting for them, so give them a moment to land.
  const settle = async (until = () => false) => {
    for (let i = 0; i < 50 && !until(); i++) await new Promise((r) => setTimeout(r, 20));
  };
  const welcomes = (email) => fake.mailsTo(email).filter((m) => m.subject === WELCOME);
  const tokenFor = (email) => server.db.prepare(
    "SELECT token FROM email_verify_tokens WHERE used_at IS NULL AND user_id = (SELECT id FROM users WHERE email = ?) ORDER BY created_at DESC"
  ).all(email).map((r) => r.token);

  test("an email sign-up gets only the confirm link at first, and the welcome once it's confirmed", async () => {
    const email = uniqueEmail();
    const client = makeClient(server.baseUrl);
    await client.post("/api/auth/signup", { email, password: PASSWORD, consent: true });
    await settle(() => fake.mailsTo(email).length > 0);
    await settle();
    assert.equal(fake.mailsTo(email).length, 1, "just the confirm link");
    assert.equal(welcomes(email).length, 0);

    const [token] = tokenFor(email);
    assert.equal((await client.post("/api/auth/verify-email", { token })).status, 200);
    await settle(() => welcomes(email).length > 0);
    const [mail] = welcomes(email);
    assert.ok(mail, "welcome sent after confirming");
    assert.match(mail.html, /https:\/\/pluggera\.example\/#\/hp/);
    assert.match(mail.html, /Welcome!/);
    assert.doesNotMatch(mail.html, /If you didn't request this/);
  });

  test("a second confirm link for the same account sends no second welcome", async () => {
    const email = uniqueEmail();
    const client = makeClient(server.baseUrl);
    await client.post("/api/auth/signup", { email, password: PASSWORD, consent: true });
    await settle(() => fake.mailsTo(email).length > 0);
    assert.equal((await client.post("/api/auth/verify-email/resend")).status, 200);
    const tokens = tokenFor(email);
    assert.equal(tokens.length, 2);

    assert.equal((await client.post("/api/auth/verify-email", { token: tokens[0] })).status, 200);
    assert.equal((await client.post("/api/auth/verify-email", { token: tokens[1] })).status, 200);
    await settle(() => welcomes(email).length > 1);
    assert.equal(welcomes(email).length, 1);
  });

  test("a Google sign-up is welcomed straight away, and only the first time", async () => {
    const email = uniqueEmail("g-welcome");
    const client = makeClient(server.baseUrl);
    const first = await client.post("/api/auth/google", { credential: googleToken({ sub: `g-${email}`, email }), consent: true });
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.equal(first.json.created, true);
    await settle(() => welcomes(email).length > 0);
    assert.equal(welcomes(email).length, 1);

    const again = await makeClient(server.baseUrl).post("/api/auth/google", { credential: googleToken({ sub: `g-${email}`, email }), consent: true });
    assert.equal(again.status, 200);
    assert.equal(again.json.created, false);
    await settle(() => welcomes(email).length > 1);
    assert.equal(welcomes(email).length, 1);
  });
});

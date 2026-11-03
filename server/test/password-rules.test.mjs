import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient } from "./harness.mjs";
import { passwordProblem } from "../src/passwordRules.js";

describe("what a password has to be", () => {
  test("too short and too long", () => {
    assert.match(passwordProblem("short"), /at least 8/);
    assert.match(passwordProblem("x".repeat(100) + "y".repeat(101)), /too long/);
  });

  test("common ones, in any case", () => {
    for (const p of ["12345678", "password", "PassWord1", "qwerty123", "losenord", "Lösenord123", "abcd1234"]) {
      assert.match(passwordProblem(p), /too easy/, p);
    }
  });

  test("one character over and over, and digits counting up or down", () => {
    for (const p of ["aaaaaaaa", "        ", "11111111", "23456789", "98765432"]) {
      assert.match(passwordProblem(p), /too easy/, JSON.stringify(p));
    }
  });

  test("ordinary passwords pass", () => {
    for (const p of ["correctpw1", "a-good-password", "blå hund springer", "13572468", "aaaaaaab"]) {
      assert.equal(passwordProblem(p), null, p);
    }
  });
});

describe("the endpoints use it", () => {
  let server, client;
  before(async () => { server = await startServer(); client = makeClient(server.baseUrl); });
  after(() => server.stop());

  test("sign-up refuses a common password and creates no account", async () => {
    const email = `weak-${Date.now()}@example.test`;
    const res = await client.post("/api/auth/signup", { email, password: "12345678", consent: true });
    assert.equal(res.status, 400);
    assert.match(res.json.error.message, /too easy/);
    const again = await client.post("/api/auth/signup", { email, password: "a-good-password", consent: true });
    assert.equal(again.status, 200, "the address is still free");
  });

  test("changing a password refuses a common one and keeps the old one", async () => {
    const res = await client.post("/api/auth/change-password", { currentPassword: "a-good-password", newPassword: "password" });
    assert.equal(res.status, 400);
    assert.match(res.json.error.message, /too easy/);
    const fine = await client.post("/api/auth/change-password", { currentPassword: "a-good-password", newPassword: "another-good-one" });
    assert.equal(fine.status, 200);
  });
});

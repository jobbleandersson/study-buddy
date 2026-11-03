import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./harness.mjs";

describe("addresses that don't exist", () => {
  let server;
  before(async () => { server = await startServer(); });
  after(async () => { await server.stop(); });

  test("the app's own address answers 200", async () => {
    const res = await fetch(`${server.baseUrl}/`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<html/i);
  });

  test("a made-up path still shows the app, with a 404", async () => {
    const res = await fetch(`${server.baseUrl}/hittepa/sida`);
    assert.equal(res.status, 404);
    assert.match(await res.text(), /<html/i);
  });

  test("/favicon.ico leads to the icon", async () => {
    const res = await fetch(`${server.baseUrl}/favicon.ico`, { redirect: "manual" });
    assert.equal(res.status, 301);
    assert.equal(res.headers.get("location"), "/assets/icon-192.png");
  });
});

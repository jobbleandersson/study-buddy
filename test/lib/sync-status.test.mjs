import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { classifyPushStatus, nextRetryDelay, RETRY_FIRST_MS, RETRY_MAX_MS } from "../../js/lib/sync-status.js";

describe("classifyPushStatus", () => {
  test("every kind of answer a save can get", () => {
    assert.equal(classifyPushStatus(200), "ok");
    assert.equal(classifyPushStatus(409), "conflict");
    assert.equal(classifyPushStatus(401), "signedout");
    assert.equal(classifyPushStatus(413), "toolarge");
    for (const s of [400, 403, 404, 429, 500, 502, 503, 504]) assert.equal(classifyPushStatus(s), "retry", String(s));
  });
});

describe("nextRetryDelay", () => {
  test("5 s, then three times longer each time, never past 5 minutes", () => {
    assert.equal(nextRetryDelay(0), RETRY_FIRST_MS);
    assert.equal(nextRetryDelay(undefined), RETRY_FIRST_MS);
    assert.equal(nextRetryDelay(5_000), 15_000);
    assert.equal(nextRetryDelay(15_000), 45_000);
    assert.equal(nextRetryDelay(200_000), RETRY_MAX_MS);
    assert.equal(nextRetryDelay(RETRY_MAX_MS), RETRY_MAX_MS);
  });
});

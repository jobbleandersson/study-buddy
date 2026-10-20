import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldAskAfterSession, feedbackBody, KINDS, MOODS } from "../../js/lib/feedback.js";

const DAY = 24 * 60 * 60_000;
const now = Date.UTC(2026, 9, 20, 12);

test("the card after a session waits until someone has done a few", () => {
  assert.equal(shouldAskAfterSession({ authed: true, sessions: 2, lastAskedAt: 0, now }), false);
  assert.equal(shouldAskAfterSession({ authed: true, sessions: 3, lastAskedAt: 0, now }), true);
});

test("it is only for signed-in students, because the server needs an account to take it", () => {
  assert.equal(shouldAskAfterSession({ authed: false, sessions: 50, lastAskedAt: 0, now }), false);
});

test("once asked, not again for three days, whether it was answered or skipped", () => {
  assert.equal(shouldAskAfterSession({ authed: true, sessions: 9, lastAskedAt: now - 1000, now }), false);
  assert.equal(shouldAskAfterSession({ authed: true, sessions: 9, lastAskedAt: now - 2 * DAY, now }), false);
  assert.equal(shouldAskAfterSession({ authed: true, sessions: 9, lastAskedAt: now - 3 * DAY, now }), true);
});

test("the body carries what the server reads, and leaves out what is empty", () => {
  const body = feedbackBody(
    { kind: "idea", message: "  Mörkt läge tack  ", mood: 4, context: "page" },
    { route: "/progress", lang: "sv", version: "studify-abc", browser: "Chrome 130 · Android" },
  );
  assert.deepEqual(body, {
    kind: "idea", message: "Mörkt läge tack", context: "page", mood: 4,
    route: "/progress", lang: "sv", version: "studify-abc", browser: "Chrome 130 · Android",
  });
});

test("no mood and no anonymous flag when none was chosen, so a mood of zero cannot be sent by mistake", () => {
  const body = feedbackBody({ kind: "problem", message: "Knappen fastnar" }, {});
  assert.equal("mood" in body, false);
  assert.equal("anonymous" in body, false);
  assert.equal(body.context, "button");
  assert.equal(feedbackBody({ kind: "other", message: "x", anonymous: true }, {}).anonymous, true);
});

test("the kinds and moods match what the server accepts", () => {
  assert.deepEqual(KINDS, ["idea", "problem", "praise", "other"]);
  assert.deepEqual(MOODS, [1, 2, 3, 4, 5]);
});

test("the card is only for the session that has just finished, not an old one opened from Framsteg", async () => {
  const { isFreshResult } = await import("../../js/lib/feedback.js");
  assert.equal(isFreshResult(now - 60_000, now), true);
  assert.equal(isFreshResult(now - 11 * 60_000, now), false);
  assert.equal(isFreshResult(now - 7 * DAY, now), false);
  assert.equal(isFreshResult(undefined, now), false);
  assert.equal(isFreshResult(0, now), false);
});

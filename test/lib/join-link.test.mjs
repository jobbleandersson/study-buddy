import "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { joinUrl, joinHash, hideJoinToken, TOKEN_RX, JOIN_KINDS } from "../../js/lib/join-link.js";

describe("join links", () => {
  test("a link is the app's own address with the token after #/join/", () => {
    const loc = { origin: "https://pluggera.se", pathname: "/" };
    assert.equal(joinUrl("class", "abcDEF123_-abcDEF123_-12", loc), "https://pluggera.se/#/join/class/abcDEF123_-abcDEF123_-12");
    assert.equal(joinHash("parent", "tok"), "#/join/parent/tok");
    // under a path (a preview deploy), the path is kept
    assert.equal(joinUrl("parent", "t", { origin: "https://x.example", pathname: "/app/" }), "https://x.example/app/#/join/parent/t");
  });

  test("the token is taken out of a route before it is recorded", () => {
    assert.equal(hideJoinToken("/join/class/abcDEF123_-abcDEF123_-12"), "/join/class/:id");
    assert.equal(hideJoinToken("/join/parent/x"), "/join/parent/:id");
    assert.equal(hideJoinToken("/classes"), "/classes");
    assert.equal(hideJoinToken("/classes/join/class/abc"), "/classes/join/class/abc", "only a route that starts with /join/");
    assert.equal(hideJoinToken(undefined), "");
  });

  test("what a token may look like, and which kinds there are", () => {
    assert.deepEqual(JOIN_KINDS, ["class", "parent"]);
    assert.ok(TOKEN_RX.test("A".repeat(24)));
    assert.ok(TOKEN_RX.test("aZ09_-aZ09_-aZ09_-aZ09_-"));
    assert.equal(TOKEN_RX.test("short"), false);
    assert.equal(TOKEN_RX.test("A".repeat(24) + "!"), false);
    assert.equal(TOKEN_RX.test("A".repeat(24) + "/x"), false);
    assert.equal(TOKEN_RX.test("A".repeat(65)), false);
  });
});

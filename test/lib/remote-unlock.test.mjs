import "./helpers.mjs";
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

// remote-voice.js unlocks its audio element from a tap. A phone may refuse the pointer-down and accept the click or the
// end of a touch, so the page listens for all three and stops listening only once a play was accepted. The browser is
// faked: a document that records its listeners, and an Audio whose play() is accepted or refused on demand.

const listeners = new Map();   // event -> Set(fn)
globalThis.document = {
  addEventListener: (e, fn) => { (listeners.get(e) || listeners.set(e, new Set()).get(e)).add(fn); },
  removeEventListener: (e, fn) => { listeners.get(e)?.delete(fn); },
};
let playResult = "refuse";
let plays = 0;
globalThis.Audio = class {
  constructor() { this.playbackRate = 1; }
  pause() {}
  play() { plays++; return playResult === "accept" ? Promise.resolve() : Promise.reject(new Error("NotAllowedError")); }
};
URL.createObjectURL = () => "blob:fake/silence";
URL.revokeObjectURL = () => {};
const fire = (e) => [...(listeners.get(e) || [])].forEach((fn) => fn());
const count = () => ["pointerdown", "touchend", "click"].reduce((n, e) => n + (listeners.get(e)?.size || 0), 0);
const tick = () => new Promise((r) => setTimeout(r, 5));

let remote;
before(async () => {
  remote = await import("../../js/lib/remote-voice.js");
  remote.setRemoteVoiceGate(() => true);
});

describe("unlocking the audio from a tap", () => {
  test("listens for the pointer-down, the end of a touch and the click", () => {
    assert.equal(listeners.get("pointerdown")?.size, 1);
    assert.equal(listeners.get("touchend")?.size, 1);
    assert.equal(listeners.get("click")?.size, 1);
  });

  test("a refused play keeps the listeners, so the next event can try again", async () => {
    playResult = "refuse";
    fire("pointerdown");
    await tick();
    assert.equal(plays, 1);
    assert.equal(count(), 3, "still listening");
    playResult = "accept";
    fire("touchend");
    await tick();
    assert.equal(plays, 2, "the touch-end tried again");
    assert.equal(count(), 0, "accepted: no more listening");
  });
});

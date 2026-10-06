import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { shapeReport, sanitizeRoute, coarseBrowser } from "../../js/lib/error-report.js";

const ORIGIN = "https://pluggera.se";
const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const WINDOWS_EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0";

describe("error-report", () => {
  test("a script error points at our own file, with the origin removed", () => {
    const r = shapeReport({
      kind: "error", message: "Uncaught TypeError: x is undefined", source: `${ORIGIN}/js/views/hp.js:12:5`,
      stack: `TypeError: x is undefined\n    at paint (${ORIGIN}/js/views/hp.js:12:5)`, origin: ORIGIN, hash: "#/hp", ua: ANDROID_CHROME, version: "studify-v242",
    });
    assert.equal(r.source, "/js/views/hp.js:12:5");
    assert.ok(!r.stack.includes(ORIGIN));
    assert.equal(r.route, "/hp");
    assert.equal(r.browser, "Chrome 129 · Android");
    assert.equal(r.version, "studify-v242");
  });

  test("noise we can't act on is dropped", () => {
    const base = { kind: "error", origin: ORIGIN, hash: "#/" };
    assert.equal(shapeReport({ ...base, message: "Script error." }), null);
    assert.equal(shapeReport({ ...base, message: "ResizeObserver loop completed with undelivered notifications." }), null);
    assert.equal(shapeReport({ ...base, kind: "rejection", message: "TypeError: Failed to fetch" }), null);
    assert.equal(shapeReport({ ...base, kind: "rejection", message: "AbortError: The user aborted a request." }), null);
    assert.equal(shapeReport({ ...base, message: "boom", source: "chrome-extension://abc/content.js:1:1" }), null);
    assert.equal(shapeReport({ ...base, message: "boom", source: "https://accounts.google.com/gsi/client:1:1" }), null);
    assert.equal(shapeReport({ ...base, message: "   " }), null);
  });

  test("an inline data: image of ours is still reported", () => {
    const r = shapeReport({ kind: "resource", message: "img failed to load", source: "data:image/gif;base64,R0lGOD…", origin: ORIGIN, hash: "#/welcome" });
    assert.ok(r);
    assert.match(r.source, /^data:image\/gif/);
  });

  test("the page loses ids and query strings", () => {
    assert.equal(sanitizeRoute("#/results/5e1dfjnaqcrn"), "/results/:id");
    assert.equal(sanitizeRoute("#/verify?token=secret"), "/verify");
    assert.equal(sanitizeRoute("#/hp/xyz"), "/hp/xyz");
    assert.equal(sanitizeRoute(""), "/");
  });

  test("the browser is reduced to its family and major version", () => {
    assert.equal(coarseBrowser(IPHONE_SAFARI), "Safari 17 · iOS");
    assert.equal(coarseBrowser(WINDOWS_EDGE), "Edge 129 · Windows");
    assert.equal(coarseBrowser(""), "other · other");
  });
});

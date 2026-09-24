import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import zlib from "node:zlib";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./harness.mjs";
import { compressionFilter } from "../src/compress.js";
import { staticCacheControl } from "../src/static-cache.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fileText = (rel) => readFileSync(path.join(ROOT, rel));

// fetch() decodes compressed bodies and hides what was sent, so use the raw http client here.
function rawGet(baseUrl, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(baseUrl + urlPath, { headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on("error", reject);
  });
}

describe("response compression", () => {
  let server;
  before(async () => { server = await startServer(); });
  after(async () => { await server.stop(); });

  test("a JS file is gzipped when the client accepts it, and unzips to the exact file", async () => {
    const original = fileText("js/store.js");
    const r = await rawGet(server.baseUrl, "/js/store.js", { "accept-encoding": "gzip" });
    assert.equal(r.status, 200);
    assert.equal(r.headers["content-encoding"], "gzip");
    assert.match(r.headers["vary"] || "", /accept-encoding/i);
    assert.ok(r.body.length < original.length / 2, `expected < half of ${original.length}, got ${r.body.length}`);
    assert.deepEqual(zlib.gunzipSync(r.body), original);
  });

  test("brotli is used when offered, and round-trips", async () => {
    const original = fileText("css/app.css");
    const r = await rawGet(server.baseUrl, "/css/app.css", { "accept-encoding": "br, gzip" });
    assert.equal(r.headers["content-encoding"], "br");
    assert.deepEqual(zlib.brotliDecompressSync(r.body), original);
  });

  test("a client that accepts nothing gets the plain file", async () => {
    const original = fileText("js/store.js");
    const r = await rawGet(server.baseUrl, "/js/store.js", { "accept-encoding": "identity" });
    assert.equal(r.headers["content-encoding"], undefined);
    assert.deepEqual(r.body, original);
  });

  test("library JSON is compressed too", async () => {
    const r = await rawGet(server.baseUrl, "/data/library/index.json", { "accept-encoding": "gzip" });
    assert.equal(r.status, 200);
    assert.equal(r.headers["content-encoding"], "gzip");
    assert.deepEqual(zlib.gunzipSync(r.body), fileText("data/library/index.json"));
  });

  test("already-compressed fonts are not compressed a second time", async () => {
    const original = fileText("assets/fonts/inter-latin.woff2");
    const r = await rawGet(server.baseUrl, "/assets/fonts/inter-latin.woff2", { "accept-encoding": "gzip, br" });
    assert.equal(r.status, 200);
    assert.equal(r.headers["content-encoding"], undefined);
    assert.deepEqual(r.body, original);
  });

  test("a tiny API reply below the size threshold is left alone", async () => {
    const r = await rawGet(server.baseUrl, "/api/health", { "accept-encoding": "gzip" });
    assert.equal(r.status, 200);
    assert.equal(r.headers["content-encoding"], undefined);
    assert.equal(JSON.parse(r.body.toString()).ok, true);
  });
});

describe("the compression filter", () => {
  const fakeRes = (type) => ({ getHeader: (h) => (h.toLowerCase() === "content-type" ? type : undefined) });

  test("never compresses the streamed AI proxy, whatever the content type", () => {
    assert.equal(compressionFilter({ originalUrl: "/api/messages", headers: {} }, fakeRes("application/json")), false);
    assert.equal(compressionFilter({ originalUrl: "/api/messages?x=1", headers: {} }, fakeRes("text/event-stream")), false);
  });

  test("never compresses any server-sent-events response", () => {
    assert.equal(compressionFilter({ originalUrl: "/api/other", headers: {} }, fakeRes("text/event-stream")), false);
  });

  test("compresses ordinary JSON and JavaScript", () => {
    assert.equal(compressionFilter({ originalUrl: "/api/state", headers: {} }, fakeRes("application/json")), true);
    assert.equal(compressionFilter({ originalUrl: "/js/main.js", headers: {} }, fakeRes("text/javascript; charset=UTF-8")), true);
  });

  test("does not compress images or fonts", () => {
    assert.equal(compressionFilter({ originalUrl: "/a.png", headers: {} }, fakeRes("image/png")), false);
    assert.equal(compressionFilter({ originalUrl: "/a.woff2", headers: {} }, fakeRes("font/woff2")), false);
  });
});

describe("cache headers on static files", () => {
  let server;
  before(async () => { server = await startServer(); });
  after(async () => { await server.stop(); });

  test("self-hosted fonts are cached for a year and marked immutable", async () => {
    const r = await rawGet(server.baseUrl, "/assets/fonts/inter-latin.woff2");
    assert.equal(r.headers["cache-control"], "public, max-age=31536000, immutable");
  });

  test("vendored libraries are cached for a week", async () => {
    const r = await rawGet(server.baseUrl, "/vendor/katex.min.js");
    assert.equal(r.headers["cache-control"], "public, max-age=604800");
  });

  test("the app's own js, css, html and data are revalidated every time", async () => {
    for (const p of ["/js/store.js", "/css/app.css", "/index.html", "/sw.js", "/data/library/index.json"]) {
      const r = await rawGet(server.baseUrl, p);
      assert.equal(r.status, 200, p);
      assert.equal(r.headers["cache-control"], "public, max-age=0", `${p} must not get a long lifetime`);
      assert.ok(r.headers["etag"], `${p} needs an ETag so revalidation can be a 304`);
    }
  });

  test("asking again with the ETag gets an empty 304, not the file", async () => {
    const first = await rawGet(server.baseUrl, "/js/store.js");
    const again = await rawGet(server.baseUrl, "/js/store.js", { "if-none-match": first.headers["etag"] });
    assert.equal(again.status, 304);
    assert.equal(again.body.length, 0);
  });

  test("the 304 still works when the client also accepts compression", async () => {
    const first = await rawGet(server.baseUrl, "/js/store.js", { "accept-encoding": "gzip" });
    const again = await rawGet(server.baseUrl, "/js/store.js", { "accept-encoding": "gzip", "if-none-match": first.headers["etag"] });
    assert.equal(again.status, 304);
    assert.equal(again.body.length, 0);
  });
});

describe("staticCacheControl", () => {
  test("long lifetimes only for fonts and vendored libraries", () => {
    assert.match(staticCacheControl("/app/assets/fonts/inter-latin.woff2"), /max-age=31536000, immutable/);
    assert.match(staticCacheControl("/app/vendor/pdf.min.js"), /max-age=604800/);
    assert.match(staticCacheControl("/app/vendor/katex.min.css"), /max-age=604800/);
  });

  test("everything else keeps the default (null)", () => {
    for (const p of ["/app/js/main.js", "/app/css/app.css", "/app/index.html", "/app/sw.js", "/app/data/library/x.json", "/app/assets/favicon.svg", "/app/assets/icon-192.png"]) {
      assert.equal(staticCacheControl(p), null, p);
    }
  });
});

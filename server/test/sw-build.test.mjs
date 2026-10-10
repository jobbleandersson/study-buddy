import { test, describe, before, after } from "node:test";
import http from "node:http";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./harness.mjs";
import { listedFiles, computeBuild, stampedSw, serviceWorker } from "../src/sw-build.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SW_SOURCE = readFileSync(path.join(ROOT, "sw.js"), "utf8");

// sw.js serves the app's own files from a cache named after BUILD, so BUILD has to follow every
// change to them; the server derives it from the files (src/sw-build.js).
describe("service worker build", () => {
  test("sw.js keeps the placeholder the server fills in, not a version written by hand", () => {
    assert.match(SW_SOURCE, /^const BUILD = "dev";$/m);
    assert.ok(stampedSw(SW_SOURCE, "abc123def456").includes('const BUILD = "abc123def456";'));
    assert.equal(stampedSw('const CACHE = "studify-v254";', "abc123def456"), null);
  });

  test("the hash covers every file sw.js lists, the start page and the language files included", () => {
    const files = listedFiles(SW_SOURCE);
    for (const f of ["index.html", "js/main.js", "js/lib/strings.sv.js", "js/lib/strings.en.js", "css/app.css", "data/library/index.json"]) {
      assert.ok(files.includes(f), `${f} is not hashed`);
    }
  });

  test("the build changes when a listed file or sw.js changes, and only then", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sb-sw-build-"));
    mkdirSync(path.join(dir, "js"));
    const sw = 'const BUILD = "dev";\nconst APP_SHELL = ["./", "./js/a.js"];\n';
    writeFileSync(path.join(dir, "index.html"), "<p>hi</p>");
    writeFileSync(path.join(dir, "js", "a.js"), "export const a = 1;");
    writeFileSync(path.join(dir, "js", "unlisted.js"), "export const b = 1;");
    const first = computeBuild(dir, sw);
    assert.match(first, /^[0-9a-f]{12}$/);
    assert.equal(computeBuild(dir, sw), first, "same files, same build");

    writeFileSync(path.join(dir, "js", "unlisted.js"), "export const b = 2;");
    assert.equal(computeBuild(dir, sw), first, "a file the worker doesn't serve from its cache is not part of it");

    writeFileSync(path.join(dir, "js", "a.js"), "export const a = 2;");
    const second = computeBuild(dir, sw);
    assert.notEqual(second, first);
    assert.notEqual(computeBuild(dir, sw + "// changed\n"), second);
  });

  test("serviceWorker() serves sw.js with its build in place", () => {
    const sw = serviceWorker(ROOT);
    assert.match(sw.build, /^[0-9a-f]{12}$/);
    assert.ok(sw.body.includes(`const BUILD = "${sw.build}";`));
    assert.ok(!sw.body.includes('const BUILD = "dev";'));
  });
});

describe("the stamped service worker over HTTP", () => {
  let server;
  before(async () => { server = await startServer({ SW_BUILD: "on" }); });
  after(async () => { await server.stop(); });

  test("/sw.js carries the build, is revalidated on every visit, and every file says which build it is", async () => {
    const r = await fetch(`${server.baseUrl}/sw.js`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /javascript/);
    assert.equal(r.headers.get("cache-control"), "no-cache");
    const build = r.headers.get("x-build");
    assert.match(build, /^[0-9a-f]{12}$/);
    assert.ok((await r.text()).includes(`const BUILD = "${build}";`));

    for (const p of ["/js/main.js", "/css/app.css", "/"]) {
      const f = await fetch(server.baseUrl + p);
      assert.equal(f.headers.get("x-build"), build, p);
    }
  });

  // The raw client: fetch() adds "Cache-Control: no-cache" to a request with a hand-set If-None-Match
  // (the fetch spec does), and a server rightly never answers that with a 304.
  const rawGet = (urlPath, headers = {}) => new Promise((resolve, reject) => {
    http.get(server.baseUrl + urlPath, { headers }, (res) => { res.resume(); res.on("end", () => resolve(res)); }).on("error", reject);
  });

  test("an unchanged sw.js is a 304 when the browser checks it", async () => {
    const first = await rawGet("/sw.js");
    assert.ok(first.headers.etag);
    const again = await rawGet("/sw.js", { "if-none-match": first.headers.etag });
    assert.equal(again.statusCode, 304);
  });
});

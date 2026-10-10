import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SHARE_PAGES, withShareMeta } from "../src/routes/share-pages.js";

// The HTTP side (/hp answering 200 with this page) is in practice-pages.test.mjs, which starts the server.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const inlineScripts = (html) => [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

test("share pages: /hp swaps in its own title, description, preview and canonical, and nothing else", () => {
  const html = withShareMeta(indexHtml, "/hp", SHARE_PAGES["/hp"]);
  assert.match(html, /<title>Högskoleprovet – öva gratis med PluggEra<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/pluggera\.se\/hp" \/>/);
  assert.match(html, /<meta property="og:url" content="https:\/\/pluggera\.se\/hp" \/>/);
  assert.match(html, /<meta property="og:image" content="https:\/\/pluggera\.se\/assets\/og-hp\.jpg" \/>/);
  for (const tag of [/<title>/g, /name="description"/g, /rel="canonical"/g, /property="og:title"/g, /property="og:image"/g, /name="twitter:image"/g]) {
    assert.equal((html.match(tag) || []).length, 1, String(tag));
  }
  assert.doesNotMatch(html, /og-pluggera\.jpg/);
  // Still private, and the inline scripts are untouched, so the CSP hashes taken from index.html still match.
  assert.match(html, /<meta name="robots" content="noindex, nofollow" \/>/);
  assert.deepEqual(inlineScripts(html), inlineScripts(indexHtml));
  assert.match(html, /<div id="app"><\/div>/);
});

test("share pages: index.html keeps the markers the swap needs", () => {
  assert.throws(() => withShareMeta("<html><head><title>x</title></head></html>", "/hp", SHARE_PAGES["/hp"]), /share-meta/);
  assert.doesNotThrow(() => withShareMeta(indexHtml, "/hp", SHARE_PAGES["/hp"]));
});

test("share pages: every preview image index.html and the share pages name is in assets/, and small enough for WhatsApp", () => {
  const images = [
    ...[...indexHtml.matchAll(/https:\/\/pluggera\.se(\/assets\/[^"]+\.(?:jpg|png))/g)].map((m) => m[1]),
    ...Object.values(SHARE_PAGES).map((p) => p.image),
  ];
  assert.ok(images.length >= 2);
  for (const img of new Set(images)) {
    const file = path.join(root, img);
    assert.ok(fs.existsSync(file), img);
    assert.ok(fs.statSync(file).size < 300_000, `${img} is over 300 KB`);
  }
});

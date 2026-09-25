import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./harness.mjs";
import { slugify, pickSamples } from "../src/routes/practice-pages.js";

const get = async (base, p) => {
  const res = await fetch(`${base}${p}`);
  return { status: res.status, type: res.headers.get("content-type") || "", body: await res.text() };
};
const firstSetPath = (html) => html.match(/href="(\/ova\/[a-z0-9-]+\/[a-z0-9-]+)"/)?.[1];

describe("public practice pages (indexing off, the default)", () => {
  let server;
  before(async () => { server = await startServer({ PUBLIC_INDEXING: "" }); });
  after(async () => { await server.stop(); });

  test("/ova lists levels and links to every subject", async () => {
    const { status, type, body } = await get(server.baseUrl, "/ova");
    assert.equal(status, 200);
    assert.match(type, /text\/html/);
    assert.match(body, /<html lang="sv"/);
    assert.match(body, /Årskurs 9/);
    assert.match(body, /href="\/ova\/ak9-matematik"/);
  });

  test("every page says noindex while PUBLIC_INDEXING isn't on, and robots.txt disallows all", async () => {
    const { body } = await get(server.baseUrl, "/ova");
    assert.match(body, /<meta name="robots" content="noindex, nofollow"/);
    const robots = await get(server.baseUrl, "/robots.txt");
    assert.equal(robots.status, 200);
    assert.match(robots.body, /Disallow: \/\n/);
  });

  test("a subject page lists its sets, and a set page shows three sample questions with answers", async () => {
    const subj = await get(server.baseUrl, "/ova/ak9-matematik");
    assert.equal(subj.status, 200);
    assert.match(subj.body, /Matematik – årskurs 9/);
    const setPath = firstSetPath(subj.body);
    assert.ok(setPath, "expected a link to a set");

    const set = await get(server.baseUrl, setPath);
    assert.equal(set.status, 200);
    assert.equal((set.body.match(/class="ova-q"/g) || []).length, 3);
    assert.equal((set.body.match(/<details class="ova-q__ans">/g) || []).length, 3);
    assert.match(set.body, /href="\/#\/start\/lib-[a-z0-9-]+"/);
    assert.match(set.body, /<link rel="canonical" href="http:\/\/127\.0\.0\.1:\d+\/ova\//);
    assert.match(set.body, /"@type":"BreadcrumbList"/);
  });

  test("unknown subjects and sets fall through to the app, not a crash", async () => {
    for (const p of ["/ova/nope", "/ova/ak9-matematik/nope"]) {
      const { status, body } = await get(server.baseUrl, p);
      assert.equal(status, 200, p);                 // the SPA fallback
      assert.doesNotMatch(body, /class="ova-q"/, p);
    }
  });

  test("the sitemap lists every set page", async () => {
    const { status, type, body } = await get(server.baseUrl, "/sitemap.xml");
    assert.equal(status, 200);
    assert.match(type, /xml/);
    assert.ok((body.match(/<loc>[^<]*\/ova\/[a-z0-9-]+\/[a-z0-9-]+<\/loc>/g) || []).length >= 300);
  });
});

describe("public practice pages with PUBLIC_INDEXING=true", () => {
  let server;
  before(async () => { server = await startServer({ PUBLIC_INDEXING: "true" }); });
  after(async () => { await server.stop(); });

  test("pages are indexable and robots.txt points at the sitemap", async () => {
    const { body } = await get(server.baseUrl, "/ova");
    assert.match(body, /<meta name="robots" content="index, follow"/);
    const robots = await get(server.baseUrl, "/robots.txt");
    assert.match(robots.body, /Allow: \//);
    assert.match(robots.body, /Sitemap: http:\/\/127\.0\.0\.1:\d+\/sitemap\.xml/);
  });
});

describe("helpers", () => {
  test("slugify folds Swedish letters and punctuation", () => {
    assert.equal(slugify("Bråk, decimaler & procent"), "brak-decimaler-procent");
    assert.equal(slugify("Samhällsfråga: l'environnement"), "samhallsfraga-l-environnement");
    assert.equal(slugify("!!!"), "set");
  });

  test("pickSamples mixes kinds and never repeats a question", () => {
    const qs = [{ id: 1, kind: "mc" }, { id: 2, kind: "mc" }, { id: 3, kind: "worked" }, { id: 4, kind: "mc" }];
    assert.deepEqual(pickSamples(qs).map((q) => q.id), [1, 3, 2]);
    assert.deepEqual(pickSamples([{ id: 9, kind: "flashcard" }]).map((q) => q.id), [9]);
  });
});

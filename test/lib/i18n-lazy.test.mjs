import { test } from "node:test";
import assert from "node:assert/strict";

// lib/i18n.js as a browser runs it: only the language on screen is loaded, a switch loads the other
// first, and a switch in another tab is followed. Outside a browser (no `document`) it loads both
// languages for the other tests, so this file stands in a minimal browser before importing it.
const stored = new Map();
globalThis.localStorage = {
  getItem: (k) => (stored.has(k) ? stored.get(k) : null),
  setItem: (k, v) => stored.set(k, String(v)),
  removeItem: (k) => stored.delete(k),
};
const htmlAttrs = {};
globalThis.document = { documentElement: { setAttribute: (k, v) => { htmlAttrs[k] = v; } } };
globalThis.window = new EventTarget();

const { t, getLang, setLang } = await import("../../js/lib/i18n.js");
const KEY = "studybuddy.lang";
const nextLangChange = () => new Promise((resolve) => window.addEventListener("sb:langchange", (e) => resolve(e.detail.lang), { once: true }));

test("only the language on screen is loaded; another one set behind its back is stood in for", () => {
  assert.equal(t("common.back"), "Tillbaka");
  stored.set(KEY, "en");                       // as if another tab had switched, before its event arrives
  assert.equal(t("common.back"), "Tillbaka");   // English isn't loaded here yet: Swedish stands in, no key
  stored.delete(KEY);
});

test("a slower switch that a later one overtook does not land", async () => {
  const toEn = setLang("en");                  // has to load the English strings first
  const toSv = setLang("sv");                  // already loaded
  assert.equal(await toSv, true);
  assert.equal(await toEn, false);
  assert.equal(getLang(), "sv");
  assert.equal(t("common.back"), "Tillbaka");
});

test("a switch loads the language, then re-renders in it", async () => {
  const changed = nextLangChange();
  assert.equal(await setLang("en"), true);
  assert.equal(await changed, "en");
  assert.equal(getLang(), "en");
  assert.equal(htmlAttrs.lang, "en");
  assert.equal(t("common.back"), "Back");
  assert.equal(await setLang("xx"), false);
});

test("a switch made in another tab is followed here", async () => {
  const changed = nextLangChange();
  stored.set(KEY, "sv");
  window.dispatchEvent(Object.assign(new Event("storage"), { key: KEY, storageArea: localStorage }));
  assert.equal(await changed, "sv");
  assert.equal(htmlAttrs.lang, "sv");
  assert.equal(t("common.back"), "Tillbaka");
});

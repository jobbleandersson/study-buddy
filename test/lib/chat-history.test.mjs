import "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  loadChats, saveChat, deleteChat, groupByDay, searchChats, chatTitle, flattenMessage,
  loadSaved, addSaved, removeSaved, findSaved, MAX_CHATS, MAX_MESSAGES, MAX_SAVED,
} from "../../js/lib/chat-history.js";

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const chat = (id, text = "hej") => ({ id, messages: [{ role: "user", content: text }, { role: "assistant", content: "svar" }] });

describe("chat history", () => {
  test("saves a chat, newest first, and updating replaces it", () => {
    const s = mem();
    saveChat(chat("a", "första"), s, 1000);
    saveChat(chat("b", "andra"), s, 2000);
    saveChat({ ...chat("a", "första"), messages: [...chat("a").messages, { role: "user", content: "mer" }] }, s, 3000);
    const list = loadChats(s);
    assert.deepEqual(list.map((c) => c.id), ["a", "b"]);
    assert.equal(list[0].messages.length, 3);
  });

  test("a chat with nothing sent is not kept", () => {
    const s = mem();
    assert.equal(saveChat({ id: "a", messages: [] }, s), false);
    assert.equal(saveChat({ id: "a", messages: [{ role: "assistant", content: "hej" }] }, s), false);
    assert.deepEqual(loadChats(s), []);
  });

  test("pictures are dropped but remembered as a flag", () => {
    const m = { role: "user", content: [{ type: "image", source: { data: "AAAA" } }, { type: "text", text: "Vad är detta?" }] };
    assert.deepEqual(flattenMessage(m), { role: "user", content: "Vad är detta?", img: true });
    const s = mem();
    saveChat({ id: "a", messages: [m] }, s);
    assert.ok(!JSON.stringify(loadChats(s)).includes("AAAA"));
    assert.equal(loadChats(s)[0].messages[0].img, true);
  });

  test("the title is the first thing the student said, shortened", () => {
    assert.equal(chatTitle([{ role: "user", content: "Fotosyntes, åk 7" }]), "Fotosyntes, åk 7");
    assert.ok(chatTitle([{ role: "user", content: "x".repeat(100) }]).length <= 60);
  });

  test("keeps at most MAX_CHATS chats and MAX_MESSAGES messages, always keeping the first message", () => {
    const s = mem();
    for (let i = 0; i < MAX_CHATS + 5; i++) saveChat(chat(`c${i}`), s, i);
    assert.equal(loadChats(s).length, MAX_CHATS);
    const long = [{ role: "user", content: "start" }];
    for (let i = 0; i < 100; i++) long.push({ role: i % 2 ? "user" : "assistant", content: `m${i}` });
    saveChat({ id: "long", messages: long }, s, 9999);
    const saved = loadChats(s).find((c) => c.id === "long");
    assert.equal(saved.messages.length, MAX_MESSAGES);
    assert.equal(saved.messages[0].content, "start");
    assert.equal(saved.messages.at(-1).content, "m99");
  });

  test("a full storage drops the oldest chats, not the one being saved", () => {
    const s = mem();
    const setItem = s.setItem;
    s.setItem = (k, v) => { if (JSON.parse(v).length > 2) throw new Error("quota"); return setItem(k, v); };
    for (let i = 0; i < 2; i++) saveChat(chat(`old${i}`), s, i);
    saveChat(chat("new"), s, 100);
    assert.equal(loadChats(s)[0].id, "new");
  });

  test("delete removes just that chat", () => {
    const s = mem();
    saveChat(chat("a"), s, 1); saveChat(chat("b"), s, 2);
    deleteChat("a", s);
    assert.deepEqual(loadChats(s).map((c) => c.id), ["b"]);
  });

  test("groups by local day: today, yesterday, earlier", () => {
    const now = new Date(2026, 8, 26, 15, 0);
    const at = (d, h) => new Date(2026, 8, d, h).getTime();
    const groups = groupByDay([{ id: "1", updatedAt: at(26, 9) }, { id: "2", updatedAt: at(25, 23) }, { id: "3", updatedAt: at(20, 12) }], now);
    assert.deepEqual(groups.map((g) => [g.key, g.chats.map((c) => c.id)]), [["today", ["1"]], ["yesterday", ["2"]], ["earlier", ["3"]]]);
    assert.deepEqual(groupByDay([{ id: "1", updatedAt: at(26, 9) }], now).map((g) => g.key), ["today"]);
  });

  test("search looks in titles and messages, ignoring case", () => {
    const s = mem();
    saveChat(chat("a", "Mitos och meios"), s, 1);
    saveChat({ id: "b", messages: [{ role: "user", content: "hej" }, { role: "assistant", content: "Fotosyntesen är viktig" }] }, s, 2);
    const all = loadChats(s);
    assert.deepEqual(searchChats(all, "MITOS").map((c) => c.id), ["a"]);
    assert.deepEqual(searchChats(all, "fotosyn").map((c) => c.id), ["b"]);
    assert.equal(searchChats(all, "").length, 2);
  });

  test("survives corrupt storage", () => {
    const s = mem();
    s.setItem("studify.chats.v1", "{not json");
    assert.deepEqual(loadChats(s), []);
    assert.equal(saveChat(chat("a"), s), true);
  });
});

describe("saved answers", () => {
  test("bookmark, find, remove", () => {
    const s = mem();
    const e = addSaved({ chatId: "a", chatTitle: "Titel", text: "Så löser du det" }, s, 1);
    assert.equal(loadSaved(s).length, 1);
    assert.equal(findSaved("a", "Så löser du det", s).id, e.id);
    removeSaved(e.id, s);
    assert.equal(loadSaved(s).length, 0);
    assert.equal(findSaved("a", "Så löser du det", s), null);
  });

  test("saving the same answer twice does nothing; empty text is refused", () => {
    const s = mem();
    addSaved({ chatId: "a", text: "x" }, s);
    addSaved({ chatId: "a", text: "x" }, s);
    assert.equal(loadSaved(s).length, 1);
    assert.equal(addSaved({ chatId: "a", text: "   " }, s), null);
  });

  test("keeps the newest MAX_SAVED", () => {
    const s = mem();
    for (let i = 0; i < MAX_SAVED + 3; i++) addSaved({ chatId: "a", text: `svar ${i}` }, s, i + 1);
    const list = loadSaved(s);
    assert.equal(list.length, MAX_SAVED);
    assert.equal(list[0].text, `svar ${MAX_SAVED + 2}`);
  });
});

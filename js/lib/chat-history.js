// Studify AI chats and bookmarked answers, kept in this browser's localStorage. They are deliberately
// not part of the synced study state: a long chat can be big, and a device-local list is what the
// history panel promises ("saved on this device"). Pure apart from the storage it is given, so it can
// be unit-tested with a Map-backed stand-in.

const CHATS_KEY = "studify.chats.v1";
const SAVED_KEY = "studify.saved.v1";

export const MAX_CHATS = 30;
export const MAX_MESSAGES = 60;
export const MAX_SAVED = 50;
export const MAX_SAVED_CHARS = 4000;

const defaultStorage = () => (typeof localStorage === "undefined" ? null : localStorage);

function read(storage, key) {
  try {
    const raw = storage?.getItem(key);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

/** Returns false if the browser refused the write (private mode, quota). */
function write(storage, key, list) {
  try { storage.setItem(key, JSON.stringify(list)); return true; } catch { return false; }
}

export function newChatId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** The text of a message, and whether it carried a picture (the picture itself is never stored). */
export function flattenMessage(m) {
  if (typeof m?.content === "string") return { role: m.role, content: m.content, img: false };
  const parts = Array.isArray(m?.content) ? m.content : [];
  return {
    role: m?.role,
    content: parts.filter((p) => p?.type === "text").map((p) => p.text).join("\n"),
    img: parts.some((p) => p?.type === "image"),
  };
}

export function chatTitle(messages) {
  const first = (messages || []).map(flattenMessage).find((m) => m.role === "user" && m.content.trim());
  const text = (first?.content || "").replace(/\s+/g, " ").trim();
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

/** All saved chats, newest first. */
export function loadChats(storage = defaultStorage()) {
  return read(storage, CHATS_KEY).filter((c) => c && c.id && Array.isArray(c.messages))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/** Insert or update a chat. Empty chats (nothing sent yet) are not kept. */
export function saveChat({ id, mode = null, material = null, messages }, storage = defaultStorage(), now = Date.now()) {
  const flat = (messages || []).map(flattenMessage).filter((m) => m.content || m.img);
  if (!id || !flat.some((m) => m.role === "user")) return false;
  const kept = flat.length > MAX_MESSAGES ? [flat[0], ...flat.slice(-(MAX_MESSAGES - 1))] : flat;
  const chat = { id, mode, title: chatTitle(kept), material, messages: kept, updatedAt: now };
  let list = [chat, ...loadChats(storage).filter((c) => c.id !== id)].slice(0, MAX_CHATS);
  // A full quota should cost the oldest chats, not the one being written.
  while (!write(storage, CHATS_KEY, list) && list.length > 1) list = list.slice(0, -1);
  return true;
}

export function deleteChat(id, storage = defaultStorage()) {
  write(storage, CHATS_KEY, loadChats(storage).filter((c) => c.id !== id));
}

/** Chats in "today" / "yesterday" / "earlier" buckets (local calendar days), newest first. */
export function groupByDay(chats, now = new Date()) {
  const day = (ts) => { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const today = day(now.getTime());
  const out = { today: [], yesterday: [], earlier: [] };
  for (const c of chats || []) {
    const age = Math.round((today - day(c.updatedAt || 0)) / 86400000);
    (age <= 0 ? out.today : age === 1 ? out.yesterday : out.earlier).push(c);
  }
  return Object.entries(out).filter(([, list]) => list.length).map(([key, list]) => ({ key, chats: list }));
}

export function searchChats(chats, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return chats || [];
  return (chats || []).filter((c) => c.title.toLowerCase().includes(q)
    || c.messages.some((m) => String(m.content).toLowerCase().includes(q)));
}

/* ---- bookmarked answers ---- */

export function loadSaved(storage = defaultStorage()) {
  return read(storage, SAVED_KEY).filter((s) => s && s.id && s.text).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

/** Bookmark an answer. Saving the same text from the same chat twice is a no-op. */
export function addSaved({ chatId = null, chatTitle: title = "", text }, storage = defaultStorage(), now = Date.now()) {
  const clean = String(text || "").trim().slice(0, MAX_SAVED_CHARS);
  if (!clean) return null;
  const existing = loadSaved(storage);
  const dupe = existing.find((s) => s.chatId === chatId && s.text === clean);
  if (dupe) return dupe;
  const entry = { id: `s${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, chatId, chatTitle: title, text: clean, savedAt: now };
  write(storage, SAVED_KEY, [entry, ...existing].slice(0, MAX_SAVED));
  return entry;
}

export function removeSaved(id, storage = defaultStorage()) {
  write(storage, SAVED_KEY, loadSaved(storage).filter((s) => s.id !== id));
}

export function findSaved(chatId, text, storage = defaultStorage()) {
  const clean = String(text || "").trim().slice(0, MAX_SAVED_CHARS);
  return loadSaved(storage).find((s) => s.chatId === chatId && s.text === clean) || null;
}

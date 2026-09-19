// One place for "get a file into the app". `fileDrop()` is a drop zone with a
// real button; `bindFileTargets()` is the drag-and-drop / paste plumbing on its
// own, for screens with a layout of their own (Solve's chat).
//
// Both listen on the whole document, so a drop or a paste lands wherever the
// pointer or focus is, while the zone lights up as the target — nobody has to
// aim at a small box. Listeners remove themselves once their zone leaves the
// page, so screens can repaint freely without cleanup calls.

import { el, icon, ICONS } from "../lib/dom.js";
import { t } from "../lib/i18n.js";

/** Does `file` satisfy an <input accept> string like ".pdf,application/zip,image/*"? */
export function matchesAccept(file, accept) {
  const tokens = String(accept || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!tokens.length) return true;
  const name = (file.name || "").toLowerCase();
  const type = (file.type || "").toLowerCase();
  return tokens.some((tok) =>
    tok.startsWith(".") ? name.endsWith(tok)
      : tok.endsWith("/*") ? type.startsWith(tok.slice(0, -1))
        : type === tok);
}

export const pasteKey = () => (/Mac|iPhone|iPad/i.test(navigator.userAgent || "") ? "⌘V" : "Ctrl+V");

const isEditable = (n) => !!n && (n.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName));
const dragHasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");

/** Wire drag-and-drop (and, with `paste`, image paste) to `zone`, which gets an
 *  `is-over` class while a file is dragged over the page. `onFiles(files, {pasted})`
 *  gets only files that match `accept`; `onReject(files)` gets the ones that don't.
 *  Returns a detach function (also called automatically once `zone` is off the page). */
export function bindFileTargets(zone, { accept, paste = false, onFiles, onReject }) {
  let timer = 0;
  const lightOff = () => { clearTimeout(timer); zone.classList.remove("is-over"); };

  function detach() {
    lightOff();
    for (const ev of ["dragenter", "dragover"]) document.removeEventListener(ev, onOver);
    document.removeEventListener("dragleave", onLeave);
    document.removeEventListener("drop", onDrop);
    document.removeEventListener("paste", onPaste);
  }
  const gone = () => { if (zone.isConnected) return false; detach(); return true; };

  function offer(files, pasted) {
    const ok = files.filter((f) => matchesAccept(f, accept));
    if (ok.length) onFiles(ok, { pasted });
    else if (files.length) onReject?.(files);
    return ok.length > 0;
  }

  function onOver(e) {
    if (gone() || !dragHasFiles(e)) return;
    e.preventDefault();                          // without this the browser opens the file instead
    e.dataTransfer.dropEffect = "copy";
    zone.classList.add("is-over");
    clearTimeout(timer); timer = setTimeout(lightOff, 350);   // dragover keeps re-arming this
  }
  function onLeave(e) { if (e.relatedTarget === null && !gone()) lightOff(); }
  function onDrop(e) {
    if (gone() || !dragHasFiles(e)) return;
    e.preventDefault();
    lightOff();
    offer(Array.from(e.dataTransfer.files), false);
  }
  function onPaste(e) {
    if (gone()) return;
    const files = Array.from(e.clipboardData?.files || []);
    if (!files.length) return;
    // Text copied out of Word or Excel also carries a picture of itself — when
    // someone is pasting into a field, that's a text paste, so leave it alone.
    if (isEditable(e.target) && e.clipboardData.getData("text/plain")) return;
    if (offer(files, true)) e.preventDefault();
  }

  for (const ev of ["dragenter", "dragover"]) document.addEventListener(ev, onOver);
  document.addEventListener("dragleave", onLeave);
  document.addEventListener("drop", onDrop);
  if (paste) document.addEventListener("paste", onPaste);
  return detach;
}

/** A drop zone. `kind: "image"` swaps the wording and icon; `paste` turns on
 *  clipboard images; `camera` adds a "Take a photo" button on touch devices.
 *  `onFile(file, {pasted})` fires for every accepted file; `onClear()` when the
 *  chip's × is used. `initial: { name, thumb }` shows an already-loaded file, so
 *  coming back to a screen doesn't hide what's still in memory.
 *  Returns { el, setThumb(src), reset() }. */
export function fileDrop({ accept, kind = "file", types = "", camera = false, paste = false, initial = null, onFile, onClear } = {}) {
  const isImage = kind === "image";

  const pick = el("input", { type: "file", accept, hidden: true, tabindex: "-1", "aria-hidden": "true" });
  const cam = camera && window.matchMedia?.("(pointer: coarse)").matches
    ? el("input", { type: "file", accept: "image/*", capture: "environment", hidden: true, tabindex: "-1", "aria-hidden": "true" })
    : null;

  const thumb = el("img.drop__thumb", { alt: "", hidden: true });
  const nameEl = el("span.drop__name");
  const removeBtn = el("button.drop__x", { type: "button", onclick: () => { reset(); onClear?.(); } }, icon(ICONS.close, 14));
  const changeBtn = el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => pick.click() },
    t(isImage ? "drop.changeImage" : "drop.changeFile"));

  const idle = el("div.drop__idle", {}, [
    el("p.drop__row", {}, [
      el("span.drop__lead", {}, t(isImage ? "drop.dragImage" : "drop.dragFile")),
      el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => pick.click() },
        t(isImage ? "drop.chooseImage" : "drop.chooseFile")),
      cam && el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => cam.click() },
        [icon(ICONS.camera, 16), t("drop.takePhoto")]),
    ]),
    types && el("p.drop__hint", {}, types),
    paste && el("p.drop__hint", {}, t("drop.paste", { key: pasteKey() })),
  ]);
  const done = el("div.drop__done", { hidden: true }, [
    el("div.drop__file", {}, [thumb, nameEl, removeBtn]),
    changeBtn,
  ]);
  const msg = el("p.drop__msg", { "aria-live": "polite" });

  const root = el("div.drop", {}, [
    el("span.drop__ic", { "aria-hidden": "true" }, icon(isImage ? ICONS.camera : ICONS.fileText, 22)),
    idle, done, msg,
    el("div.drop__release", { "aria-hidden": "true" }, t("drop.release")),
    pick, cam,
  ]);

  function showChip(name) {
    msg.className = "drop__msg"; msg.textContent = "";
    nameEl.textContent = name;
    removeBtn.setAttribute("aria-label", t("drop.remove", { name }));
    thumb.hidden = true;
    idle.hidden = true; done.hidden = false; root.classList.add("has-file");
  }
  function take(files, { pasted = false } = {}) {
    const f = files[0];
    if (!f) return;
    showChip(pasted && isImage ? t("drop.pastedName") : f.name);
    onFile?.(f, { pasted });
  }
  function reject() {
    msg.className = "drop__msg is-warn";
    msg.textContent = t("drop.wrongType", { types: types || accept });
  }
  function reset() {
    idle.hidden = false; done.hidden = true; root.classList.remove("has-file");
    thumb.hidden = true; thumb.removeAttribute("src");
    msg.className = "drop__msg"; msg.textContent = "";
    pick.value = ""; if (cam) cam.value = "";
  }

  for (const input of [pick, cam].filter(Boolean)) {
    input.addEventListener("change", () => {
      const files = Array.from(input.files || []);
      const ok = files.filter((f) => matchesAccept(f, input.accept));
      if (ok.length) take(ok); else if (files.length) reject();
      input.value = "";     // the same file can be picked again after removing it
    });
  }

  bindFileTargets(root, { accept, paste, onFiles: take, onReject: reject });

  if (initial?.name) {
    showChip(initial.name);
    if (initial.thumb) { thumb.src = initial.thumb; thumb.hidden = false; }
  }

  return {
    el: root,
    setThumb(src) { if (src) { thumb.src = src; thumb.hidden = false; } },
    reset,
  };
}

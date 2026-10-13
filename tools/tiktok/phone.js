// The phone stage the showcase videos are built on (showcase.js): coloured background layers, a phone
// with every app screen capture-showcase.mjs shot (out/showcase/), captions above it, and the moves —
// a screen pushed in, a tap, a zoom, a scroll, a search typed out. Moves that make a sound add it to
// the stage's sound list (sfx.js), so the cuts, taps and text land with their clicks and whooshes.

import { rich, title } from "./slides.js";
import { clamp, splitWords, pop, words } from "./motion.js";

export const K = 744 / 390;                          // canvas px per CSS px of the app
export const PHONE = { x: 150, y: 600, bezel: 18, status: 47 };
const SHOTS = "out/showcase/";

/** The phone's translate and scale that put the app's point (cx, cy) (CSS px on its screen) at
 *  (tx, ty) on the canvas, s times its size. */
export function focus(cx, cy, s, tx = 540, ty = 1080) {
  const px = PHONE.bezel + cx * K, py = PHONE.bezel + (PHONE.status + cy) * K;
  return { x: tx - PHONE.x - s * px, y: ty - PHONE.y - s * py, s };
}

const STATUS_ICONS = `<span><svg viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1" fill="currentColor"/><rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="currentColor"/><rect x="10" y="3" width="3" height="9" rx="1" fill="currentColor"/><rect x="15" y="0" width="3" height="12" rx="1" fill="currentColor"/></svg><svg viewBox="0 0 16 12"><path d="M8 11.5 5.6 9a3.4 3.4 0 0 1 4.8 0L8 11.5ZM3.2 6.6a6.8 6.8 0 0 1 9.6 0l-1.4 1.4a4.8 4.8 0 0 0-6.8 0L3.2 6.6ZM.8 4.2a10.2 10.2 0 0 1 14.4 0l-1.4 1.4a8.2 8.2 0 0 0-11.6 0L.8 4.2Z" fill="currentColor"/></svg><svg viewBox="0 0 27 12"><rect x=".5" y=".5" width="22" height="11" rx="3.5" fill="none" stroke="currentColor" opacity=".45"/><rect x="2" y="2" width="16" height="8" rx="2" fill="currentColor"/><rect x="24" y="4" width="2" height="4" rx="1" fill="currentColor" opacity=".45"/></svg></span>`;

/** A phone (bezel, camera, status bar) around `inner`, the screens of its view. */
export const phoneHtml = (inner, style = "") => `<div class="phone" style="--k:${K};${style}"><div class="screen"><div class="island"></div><div class="status"><b>9:41</b>${STATUS_ICONS}</div><div class="view">${inner}</div></div></div>`;

/** Lays out the stage in `frame` and returns it with its helpers. Call ready() once the story's own
 *  elements are added: it waits for the images and fonts and sizes the caption type. */
export async function phoneStage(tl, frame) {
  const shots = await (await fetch(`${SHOTS}shots.json`)).json();
  frame.innerHTML = `<div class="stage-all"><div class="bgs"></div><div class="phonewin"></div><div class="over"></div></div>`;
  const all = frame.firstElementChild;
  const [bgs, win, over] = all.children;
  const add = (html, parent = over) => { parent.insertAdjacentHTML("beforeend", html); return parent.lastElementChild; };
  const sfx = [];
  const sound = (kind, t) => { sfx.push({ kind, t }); };

  /* ---- backgrounds: each one added wipes in over the ones before ---- */
  const layers = [];
  // The textures drift and the discs float; for a looping video the drift is whole tiles over its
  // length and the float whole swings, so the last frame runs straight into the first.
  let loopLen = null;
  const drift = (now, speed) => (loopLen ? (now / loopLen) * Math.max(1, Math.round((speed * loopLen) / 46)) * 46 : now * speed);
  const swing = (now) => (loopLen ? (now / loopLen) * Math.max(1, Math.round((0.7 * loopLen) / (2 * Math.PI))) * 2 * Math.PI : now * 0.7);
  const layer = (series, full = false) => {
    const l = add(`<div class="bg" data-series="${series}" style="--wipe:${full ? 3000 : 0}"><div class="tex"></div><div class="disc"></div></div>`, bgs);
    layers.push(l);
    return l;
  };
  tl.each((now) => layers.forEach((l, k) => {
    l.firstElementChild.style.translate = `${-drift(now, 9)}px ${-drift(now, 6)}px`;
    l.lastElementChild.style.translate = `0 ${Math.sin(swing(now) + k) * 18}px`;
  }));

  /* ---- the phone and its screens ---- */
  const phone = add(phoneHtml(""), win);
  const view = phone.querySelector(".view");
  const src = (name) => `${SHOTS}${shots.shots[name].file}`;
  const screen = (inner) => add(`<div class="scr" style="opacity:0">${inner}</div>`, view);
  /** A whole page that scrolls under the app's fixed bars (laid over it, as on a phone). */
  const scroller = (page, top, tab) => screen(`<img class="pg" src="${src(page)}" alt="">`
    + (top ? `<img src="${src(top)}" style="top:${(shots.shots[top].y || 0) * K}px" alt="">` : "")
    + (tab ? `<img class="tab" src="${src(tab)}" alt="">` : ""));
  const one = (name) => screen(`<img src="${src(name)}" alt="">`);
  const screens = {
    landing: scroller("landing-page", "landing-head"),
    library: scroller("library-page", "app-top", "app-tab"),
    q0: one("q-0"), q1: one("q-1"), q2: one("q-2"),
    hp: one("hp"),
    refs: screen([...Array(11).keys()].map((k) => `<img src="${src(`ref-${k}`)}" alt="">`).join("")),
    solve: one("solve"),
    profile: one("profile"),
  };
  const tap = add(`<div class="tap"></div>`, view);

  /* ---- captions ---- */
  const caps = [];
  const caption = (series, chip, line, top = 210) => {
    const c = add(`<div class="cap" data-series="${series}" style="top:${top}px">${chip ? `<p class="label">${rich(chip)}</p>` : ""}${title(line, "h2", 88, 60)}</div>`);
    caps.push(c);
    return c;
  };

  /** Shrinks a line until it fits its width and maxH; returns the size it ended at. */
  const fitLine = (h, max, min, maxH) => {
    let size = max;
    const set = () => { h.style.fontSize = `${size}px`; };
    set();
    while ((h.scrollWidth > h.clientWidth + 1 || h.offsetHeight > maxH) && size > min) { size -= 3; set(); }
    return size;
  };
  const ready = async ({ capMax = 88 } = {}) => {
    await Promise.all([...all.querySelectorAll("img")].map((i) => i.decode().catch(() => {})));
    await document.fonts.ready;
    all.querySelectorAll(".h").forEach(splitWords);
    for (const c of caps) fitLine(c.querySelector(".h"), capMax, 60, c.querySelector(".label") ? 290 : 300);
  };

  /* ---- moves ---- */
  const wipe = (l, at, wx = 540, wy = 1920, dur = 0.75) => {
    l.style.setProperty("--wx", `${wx}px`);
    l.style.setProperty("--wy", `${wy}px`);
    tl.tween(l, at, dur, { "--wipe": 0 }, { "--wipe": 2400 }, "inOut");
  };
  const capIn = (c, at, gap = 0.06) => {
    const chip = c.querySelector(".label");
    if (chip) pop(tl, chip, at, { s: 0.3, r: -8 });
    sound("pop", at + 0.05);
    return words(tl, c.querySelector(".h"), at + 0.1, gap);
  };
  const capOut = (c, at, dur = 0.3) => tl.tween(c, at, dur, {}, { o: 0, y: -60 }, "in");
  /** The next screen slides in from the right as the last one leaves to the left (blurring as it
   *  goes when `blur` is set). */
  const push = (from, to, at, dur = 0.5, blur = 0) => {
    tl.tween(to, at, dur, { o: 1, x: 744 }, { o: 1, x: 0 }, "inOut");
    tl.tween(from, at, dur, {}, { x: -744 }, "inOut");
    if (blur) for (const el of [from, to]) tl.tween(el, at, dur / 2, { "--blur": 0 }, { "--blur": blur }, "in").tween(el, at + dur / 2, dur / 2, {}, { "--blur": 0 }, "out");
    sound("whoosh", at - 0.08);
  };
  const showAt = (scr, at) => tl.tween(scr, at, 0.08, { o: 0 }, { o: 1 }, "linear");
  /** A finger's tap on the middle of a box (CSS px on the screen). */
  const tapAt = (r, at) => {
    const x = (r.x + r.w / 2) * K, y = (r.y + r.h / 2) * K;
    tl.tween(tap, at, 0, { x, y }, { x, y }, "linear");
    tl.tween(tap, at, 0.14, { o: 0, s: 0.4 }, { o: 1, s: 1 }, "out").tween(tap, at + 0.14, 0.4, {}, { o: 0, s: 1.6 }, "out");
    sound("tick", at);
  };
  /** Zoom the phone in on a box and hold; back out after `hold` (or never, with hold = null). */
  const zoom = (r, s, at, hold, ty = 1080, dur = 0.7) => {
    tl.tween(phone, at, dur, {}, focus(r.x + r.w / 2, r.y + r.h / 2, s, 540, ty), "inOut");
    if (hold != null) tl.tween(phone, at + dur + hold, 0.6, {}, { x: 0, y: 0, s: 1 }, "inOut");
  };
  const scrollTo = (scr, y, at, dur) => tl.tween(scr.querySelector(".pg"), at, dur, {}, { y: -y * K }, "inOut");
  /** The search typed out a letter every `step` seconds, from `at`. */
  const typing = (at, step = 0.1) => {
    const imgs = [...screens.refs.querySelectorAll("img")];
    tl.each((now) => {
      const k = clamp(Math.floor((now - at) / step) + 1, 0, imgs.length - 1);
      imgs.forEach((im, i) => { im.style.opacity = i === k ? "1" : "0"; });
    });
    for (let k = 1; k < imgs.length; k++) sound("type", at + (k - 1) * step);
    return at + (imgs.length - 1) * step;
  };

  const loop = (length) => { loopLen = length; };

  return { shots, R: shots.rects, all, add, over, layer, phone, view, screens, tap, caption, ready, fitLine, wipe, capIn, capOut, push, showAt, tapAt, zoom, scrollTo, typing, sound, sfx, loop };
}

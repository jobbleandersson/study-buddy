// The motion engine behind every TikTok video page (video.html, showcase.html): a timeline where every
// frame is computed from its time t, the usual entrances (rise, pop, words popping in with a
// highlighter stroke), and the page API render-videos.mjs drives — build a video, step through it
// frame by frame, and hand each shot frame to the H.264 encoder in mp4.js.

import { createMp4, encodeAac } from "./mp4.js";
import { renderSfx } from "./sfx.js";

export const FPS = 30;

/* ---------------- the timeline ---------------- */

export const EASE = {
  linear: (p) => p,
  in: (p) => p ** 3,
  out: (p) => 1 - (1 - p) ** 3,
  inOut: (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2),
  back: (p) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2,
};
const BASE = { o: 1, x: 0, y: 0, s: 1, r: 0, sweep: 100 };
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Tweens on opacity (o), position (x, y), scale (s), rotation (r), the highlighter (sweep, %) and any
 *  CSS custom property ("--name", set as a bare number for the page's calc()).
 *  Position, scale and rotation use the separate CSS translate/scale/rotate properties, so they add to
 *  an element's own transform (a tilted sticker stays tilted). Before its first tween starts an element
 *  holds that tween's starting values, so anything that animates in is hidden until its moment. */
export class Timeline {
  constructor() { this.tweens = []; this.hooks = []; }
  tween(el, at, dur, from, to, ease = "out") {
    if (el) this.tweens.push({ el, at, dur, from: from || {}, to, ease: EASE[ease] });
    return this;
  }
  each(fn) { this.hooks.push(fn); return this; }
  seek(t) {
    const state = new Map(), ends = new Map();
    for (const tw of [...this.tweens].sort((a, b) => a.at - b.at)) {
      const st = state.get(tw.el) || state.set(tw.el, {}).get(tw.el);
      const end = ends.get(tw.el) || ends.set(tw.el, {}).get(tw.el);
      const p = tw.dur > 0 ? clamp((t - tw.at) / tw.dur, 0, 1) : (t >= tw.at ? 1 : 0);
      for (const [k, b] of Object.entries(tw.to)) {
        const a = k in tw.from ? tw.from[k] : (end[k] ?? BASE[k]);
        if (t >= tw.at) st[k] = a + (b - a) * tw.ease(p);
        else if (!(k in st)) st[k] = a;
        end[k] = b;
      }
    }
    for (const [el, st] of state) {
      if ("o" in st) el.style.opacity = String(st.o);
      if ("x" in st || "y" in st) el.style.translate = `${st.x ?? 0}px ${st.y ?? 0}px`;
      if ("s" in st) el.style.scale = String(st.s);
      if ("r" in st) el.style.rotate = `${st.r}deg`;
      if ("sweep" in st) el.style.setProperty("--sweep", `${st.sweep}%`);
      for (const k in st) if (k.startsWith("--")) el.style.setProperty(k, String(st[k]));
    }
    for (const fn of this.hooks) fn(t);
  }
}

/* ---------------- building blocks ---------------- */

/** Wraps every word of a title in span.w, so the words can pop in one by one; a formula is one word.
 *  Punctuation right after a highlight or a formula joins its last word, so a line never starts
 *  with a comma. */
export function splitWords(root) {
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        const lead = child.textContent.match(/^[.,:;!?)]+/)?.[0];
        const prevWord = child.previousSibling?.nodeType === Node.ELEMENT_NODE
          && [...(child.previousSibling.classList.contains("w") ? [child.previousSibling] : child.previousSibling.querySelectorAll(".w"))].pop();
        if (lead && prevWord) {
          prevWord.append(lead);
          child.textContent = child.textContent.slice(lead.length);
        }
        const frag = document.createDocumentFragment();
        for (const part of child.textContent.split(/([ \t\n]+)/)) {
          if (!part) continue;
          if (/^[ \t\n]+$/.test(part)) { frag.append(part); continue; }
          const w = document.createElement("span");
          w.className = "w";
          w.textContent = part;
          frag.append(w);
        }
        child.replaceWith(frag);
      } else if (child.nodeType === Node.ELEMENT_NODE && child.classList.contains("katex")) {
        const w = document.createElement("span");
        w.className = "w";
        child.replaceWith(w);
        w.append(child);
      } else if (child.nodeType === Node.ELEMENT_NODE && child.tagName !== "BR") {
        walk(child);
      }
    }
  };
  walk(root);
}

export const rise = (tl, el, at, y = 70, dur = 0.45) => tl.tween(el, at, dur, { o: 0, y }, { o: 1, y: 0 }, "out");
export const pop = (tl, el, at, { s = 0.4, r = 0, dur = 0.5 } = {}) => tl.tween(el, at, dur, { o: 0, s, r }, { o: 1, s: 1, r: 0 }, "back");
export const leave = (tl, scene, at) => tl.tween(scene, at, 0.32, {}, { o: 0, y: -100 }, "in");
/** A scene stays hidden until its moment; its parts then animate in on their own. */
export const show = (tl, scene, at) => tl.tween(scene, at, 0, { o: 0 }, { o: 1 }, "linear");

/** The title's words pop in one after another, then each highlighted phrase gets its highlighter
 *  stroke. Returns when it's done. */
export function words(tl, h, at, gap = 0.065) {
  const ws = [...h.querySelectorAll(".w")];
  ws.forEach((w, k) => tl.tween(w, at + k * gap, 0.42, { o: 0, y: 50, s: 0.8 }, { o: 1, y: 0, s: 1 }, "back"));
  let end = at + Math.max(0, ws.length - 1) * gap + 0.4;
  for (const m of h.querySelectorAll("mark")) {
    tl.tween(m, end - 0.05, 0.36, { sweep: 0 }, { sweep: 100 }, "inOut");
    end += 0.22;
  }
  return end + 0.2;
}

/* ---------------- the page API for render-videos.mjs ---------------- */

let mp4 = null, bytes = null;

/** Installs the page API. build(spec, tl) lays out the video for a spec, adds its tweens to the
 *  timeline and returns { length, cover, fits?, sfx? }: its length in seconds, the moment that makes
 *  the best cover, how each scene fitted the safe area, and its sound effects ({ t, kind }, see
 *  sfx.js; without them the video is silent). */
export function record(build) {
  let tl = null, info = null;
  window.setupVideo = async (spec) => {
    tl = new Timeline();
    info = await build(spec, tl);
    tl.seek(0);
    const { sfx, ...rest } = info;
    return { fits: [], ...rest, sounds: sfx?.length || 0, frames: Math.ceil(info.length * FPS) };
  };
  window.seekVideo = (t) => { tl.seek(t); return true; };
  window.startEncoding = async () => { mp4 = await createMp4({ width: 1080, height: 1920, fps: FPS, bitrate: 5_000_000 }); return true; };
  /** One shot frame (a JPEG, base64) into the encoder. */
  window.addFrame = async (jpeg) => {
    const blob = await (await fetch(`data:image/jpeg;base64,${jpeg}`)).blob();
    const image = await createImageBitmap(blob);
    await mp4.add(image);
    image.close();
    return true;
  };
  window.finishEncoding = async () => {
    const audio = info.sfx?.length ? await encodeAac(await renderSfx(info.sfx, Math.ceil(info.length * FPS) / FPS)) : null;
    bytes = await mp4.finish({ audio });
    return bytes.length;
  };
  /** The finished file, a slice at a time (base64), so no single message gets huge. */
  window.readVideo = (from, to) => {
    let s = "";
    const part = bytes.subarray(from, to);
    for (let k = 0; k < part.length; k += 0x8000) s += String.fromCharCode(...part.subarray(k, k + 0x8000));
    return btoa(s);
  };
}

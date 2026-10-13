// The ad: a problem → solution story for paid TikTok (~20 s), built from the same pieces as the other
// videos but staged differently. Full-frame scenes that swipe up like the TikTok feed; phones tilted
// in 3D instead of flat; a zoom straight through the screen; a fan of three phones; a phone that flips.
//   1. The problem: "Pluggar i timmar men glömmer allt?" over a page of notes that gets highlighted
//      line by line — and then fades away.
//   2. The fix: "Testa dig själv i stället." A question answered on a tilted phone, the explanation
//      pushed in on.
//   3. Through the screen to the forgetting curve, drawing itself: questions come back just before
//      you'd forget them (schematic, and labelled so).
//   4. Three phones fan out (library, Högskoleprovet, formulas) with the site's own numbers stuck on.
//   5. The middle one flips round to PluggEra AI.
//   6. "Testa gratis idag", the address, and a tap on it.
// The screens are the ones capture-showcase.mjs shot; the copy comes from the spec in videos.mjs.

import { ICON, SPARKLE, rich, title, LAYOUTS, fit, curveSvg } from "./slides.js";
import { clamp, EASE, splitWords, pop, words } from "./motion.js";
import { K, phoneHtml } from "./phone.js";

const SHOTS = "out/showcase/";
const HALF_W = 390, HALF_H = 868;   // the phone's centre, from its top-left corner

/** Where the app's point (cx, cy) (CSS px on the screen) sits relative to the phone's centre. */
const offset = (cx, cy) => ({ x: 18 + cx * K - HALF_W, y: 18 + (47 + cy) * K - HALF_H });

export async function ad(spec, tl) {
  const shots = await (await fetch(`${SHOTS}shots.json`)).json();
  const R = shots.rects, copy = spec.copy;
  const src = (name) => `${SHOTS}${shots.shots[name].file}`;
  const frame = document.getElementById("frame");
  frame.innerHTML = `<div class="stage-all ad"></div>`;
  const all = frame.firstElementChild;
  const add = (html, parent = all) => { parent.insertAdjacentHTML("beforeend", html); return parent.lastElementChild; };
  const sfx = [];
  const sound = (kind, t) => { sfx.push({ kind, t }); };

  /* ---- building blocks ---- */
  const scene = (series) => add(`<div class="sc" data-series="${series}"><div class="tex"></div><div class="disc"></div></div>`);
  const caps = [];
  const cap = (parent, line, max = 96, maxH = 300) => { const c = add(`<div class="cap">${title(line, "h2", max, 64)}</div>`, parent); Object.assign(c.dataset, { max, maxh: maxH }); caps.push(c); return c; };
  const rig = (parent) => add(`<div class="rig"></div>`, parent);
  /** A phone centred on (cx, cy), showing the first of `names` (the rest wait, hidden, to be shown). */
  const phone = (parent, names, cx, cy) => add(phoneHtml(
    names.map((n, i) => `<div class="scr" style="opacity:${i ? 0 : 1}"><img src="${src(n)}" alt=""></div>`).join("") + `<div class="tap"></div>`,
    `left:${cx - HALF_W}px;top:${cy - HALF_H}px`), parent);
  const sticker = (parent, html, x, y, turn) => add(`<div class="sticker" style="left:${x}px;top:${y}px;transform:rotate(${turn}deg)">${html}</div>`, parent);
  const screenOf = (ph, k) => ph.querySelectorAll(".scr")[k];
  const swap = (ph, from, to, at) => { tl.tween(screenOf(ph, from), at, 0.06, {}, { o: 0 }, "linear"); tl.tween(screenOf(ph, to), at, 0.06, { o: 0 }, { o: 1 }, "linear"); };
  /** A finger's tap on the middle of a box on a phone's screen. */
  const tapOn = (ph, r, at) => {
    const t = ph.querySelector(".tap"), x = (r.x + r.w / 2) * K, y = (r.y + r.h / 2) * K;
    tl.tween(t, at, 0, { x, y }, { x, y }, "linear");
    tl.tween(t, at, 0.14, { o: 0, s: 0.4 }, { o: 1, s: 1 }, "out").tween(t, at + 0.14, 0.4, {}, { o: 0, s: 1.6 }, "out");
    sound("tick", at);
  };
  /** The feed swipe: the next scene comes up from below as the last one leaves above. */
  const swipe = (from, to, at) => {
    tl.tween(to, at, 0.45, { y: 1920 }, { y: 0 }, "inOut");
    tl.tween(from, at, 0.45, {}, { y: -1920 }, "inOut");
    sound("whoosh", at - 0.05);
  };

  /* ---- 1. the problem ---- */
  const S1 = scene("navy");
  const cap1 = cap(S1, copy.hook, 124, 410);
  const notes = add(`<div class="notes">${copy.notes.map((l) => `<p><mark>${rich(l)}</mark></p>`).join("")}</div>`, S1);
  const stamp = add(`<div class="stamp-red">${rich(copy.stamp)}</div>`, S1);

  /* ---- 2. the fix ---- */
  const S2 = scene("ak9");
  const cap2 = cap(S2, copy.fix);
  const ph2 = phone(rig(S2), ["q-0", "q-1", "q-2"], 540, 1250);
  const stk2 = sticker(S2, `${ICON.check}${rich(copy.fixSticker)}`, 70, 1200, -6);

  /* ---- 3. the curve ---- */
  const S3 = scene("formula");
  const cap3 = cap(S3, copy.curve);
  const card3 = add(`<div class="card curve curvecard">${curveSvg(true)}<div class="curve__legend"><span><i style="background:var(--on-paper)"></i>${rich(copy.curveWith)}</span><span><i style="background:#B9C0D0"></i>${rich(copy.curveWithout)}</span></div></div>`, S3);
  const note3 = add(`<p class="schematic">Schematisk bild</p>`, S3);
  const stk3 = sticker(S3, rich(copy.curveSticker), 150, 1270, 3);

  /* ---- 4 and 5. the fan, and the flip to AI ---- */
  const S4 = scene("tips");
  const wipe5 = add(`<div class="bg" data-series="ord" style="--wipe:0"><div class="tex"></div><div class="disc"></div></div>`, S4);
  const cap4 = cap(S4, copy.fan);
  const cap5 = cap(S4, copy.ai);
  cap5.dataset.series = "ord";
  const rig4 = rig(S4);
  const left = phone(rig4, ["library"], 540, 1180), right = phone(rig4, ["ref-0"], 540, 1180), mid = phone(rig4, ["hp", "solve"], 540, 1180);
  const stats = copy.stats.map(([big, small], k) => sticker(S4, `${big}<small>${small}</small>`, [70, 520, 120][k], [600, 1290, 1420][k], [-6, 4, -3][k]));
  const stk5 = sticker(S4, rich(copy.aiSticker), 90, 1330, -4);
  stk5.dataset.series = "ord";

  /* ---- 6. the address ---- */
  const S6 = scene("hp");
  const close = add(`<div class="close"><div class="main">${LAYOUTS.cta(copy.cta)}</div></div>`, S6);
  const sparkles = add(`<div class="deco">${SPARKLE(948, 300, 90, 8)}${SPARKLE(40, 1520, 70, 14)}${SPARKLE(880, 1330, 56, -10)}</div>`, S6);
  const tapCta = add(`<div class="tap"></div>`, S6);
  const flash = add(`<div class="fx-flash"></div>`);

  /* ---- wait for images and fonts, size the type ---- */
  await Promise.all([...all.querySelectorAll("img")].map((i) => i.decode().catch(() => {})));
  await document.fonts.ready;
  all.querySelectorAll(".h, .notes p").forEach(splitWords);
  for (const c of caps) {
    const h = c.querySelector(".h");
    let size = Number(c.dataset.max);
    const set = () => { h.style.fontSize = `${size}px`; };
    set();
    while ((h.scrollWidth > h.clientWidth + 1 || h.offsetHeight > Number(c.dataset.maxh)) && size > 64) { size -= 3; set(); }
  }
  const main = close.querySelector(".main");
  fit(main, false);
  const url = main.querySelector(".url"), ur = url.getBoundingClientRect();
  tapCta.style.left = `${ur.left + ur.width * 0.7}px`;
  tapCta.style.top = `${ur.top + ur.height / 2}px`;
  const curvePath = card3.querySelector("svg path:last-of-type");
  const curveLen = curvePath.getTotalLength();
  curvePath.style.strokeDasharray = String(curveLen);

  /* ---- 1. the problem (0 – 2.3 s): readable from the first frame ---- */
  for (const m of cap1.querySelectorAll("mark")) tl.tween(m, 0.12, 0.42, { sweep: 0 }, { sweep: 100 }, "inOut");
  sound("pop", 0.14);
  tl.tween(notes, 0, 2.4, { y: 26, r: -1 }, { y: -12, r: 0 }, "out");
  notes.querySelectorAll("mark").forEach((m, k) => {
    tl.tween(m, 0.45 + k * 0.15, 0.2, { sweep: 0 }, { sweep: 100 }, "inOut");
    sound("type", 0.47 + k * 0.15);
  });
  const fade = 1.35;
  notes.querySelectorAll(".w").forEach((w, k) => tl.tween(w, fade + ((k * 7) % 23) * 0.016, 0.38, { o: 1, y: 0 }, { o: 0.07, y: 8 }, "out"));
  notes.querySelectorAll("mark").forEach((m, k) => tl.tween(m, fade + 0.05 + k * 0.03, 0.35, {}, { sweep: 0 }, "in"));
  sound("whoosh", fade + 0.05);
  const slam = 1.85;
  tl.tween(stamp, slam, 0.18, { o: 0, s: 2.6, r: -30 }, { o: 1, s: 1, r: 0 }, "in");
  sound("thump", slam + 0.15);
  tl.tween(notes, slam + 0.16, 0.05, {}, { x: 14 }, "linear").tween(notes, slam + 0.21, 0.05, {}, { x: -10 }, "linear").tween(notes, slam + 0.26, 0.06, {}, { x: 0 }, "out");

  /* ---- 2. the fix (2.5 – 6.5 s) ---- */
  const a = 2.5;
  swipe(S1, S2, a);
  tl.tween(ph2, a + 0.1, 0.9, { s: 0.68, y: 360, "--rx": 30, "--ry": -26 }, { s: 0.78, y: 0, "--rx": 7, "--ry": -12 }, "back");
  words(tl, cap2.querySelector(".h"), a + 0.35, 0.05);
  sound("pop", a + 0.4);
  tapOn(ph2, R.rightChoice, a + 1.2);
  swap(ph2, 0, 1, a + 1.27);
  tapOn(ph2, R.check, a + 1.75);
  swap(ph2, 1, 2, a + 1.82);
  sound("chime", a + 1.85);
  // Push in on the explanation, straightening the phone.
  const fb = offset(R.feedback.x + R.feedback.w / 2, R.feedback.y + R.feedback.h / 2);
  tl.tween(ph2, a + 2.05, 0.6, {}, { s: 1.12, x: -1.12 * fb.x, y: 1010 - 1250 - 1.12 * fb.y, "--rx": 3, "--ry": -4 }, "inOut");
  pop(tl, stk2, a + 2.45, { s: 0.3, r: -20 });
  sound("pop", a + 2.48);

  /* ---- 3. through the screen to the curve (6.3 – 9.9 s) ---- */
  const b = a + 4.0;
  tl.tween(stk2, b - 0.45, 0.2, {}, { o: 0 }, "in");
  tl.tween(ph2, b - 0.45, 0.45, {}, { s: 6, x: 0, y: -700, "--rx": 0, "--ry": 0 }, "in");
  sound("whoosh", b - 0.5);
  tl.tween(flash, b - 0.12, 0.12, { o: 0 }, { o: 1 }, "linear").tween(flash, b, 0.4, {}, { o: 0 }, "out");
  tl.tween(S3, b, 0, { o: 0 }, { o: 1 }, "linear");
  tl.tween(S2, b, 0, {}, { o: 0 }, "linear");
  words(tl, cap3.querySelector(".h"), b + 0.15, 0.05);
  sound("pop", b + 0.2);
  tl.tween(card3, b + 0.1, 0.5, { o: 0, y: 90, r: -3 }, { o: 1, y: 0, r: 0 }, "back");
  const draw = b + 0.55, drawFor = 1.9;
  tl.each((now) => { curvePath.style.strokeDashoffset = String(curveLen * (1 - EASE.inOut(clamp((now - draw) / drawFor, 0, 1)))); });
  for (const d of [1, 3, 7]) sound("tick", draw + drawFor * (d / 14) * 0.9 + 0.08);
  tl.tween(note3, draw + drawFor, 0.3, { o: 0 }, { o: 1 }, "out");
  pop(tl, stk3, draw + drawFor + 0.1, { s: 0.3, r: 18 });
  sound("pop", draw + drawFor + 0.12);

  /* ---- 4. the fan (9.9 – 13.4 s) ---- */
  const c = b + 3.6;
  swipe(S3, S4, c);
  words(tl, cap4.querySelector(".h"), c + 0.35, 0.05);
  sound("pop", c + 0.4);
  for (const ph of [left, right, mid]) tl.tween(ph, c + 0.15, 0.6, { s: 0.5, y: 640 }, { s: 0.55, y: 0 }, "out");
  tl.tween(left, c + 0.7, 0.55, {}, { x: -275, y: 52, r: -10 }, "back");
  tl.tween(right, c + 0.7, 0.55, {}, { x: 275, y: 52, r: 10 }, "back");
  sound("whoosh", c + 0.68);
  stats.forEach((st, k) => { pop(tl, st, c + 1.25 + k * 0.22, { s: 0.2, r: -25 }); sound("pop", c + 1.28 + k * 0.22); });

  /* ---- 5. the flip to AI (13.4 – 16.2 s) ---- */
  const d = c + 3.4;
  stats.forEach((st) => tl.tween(st, d - 0.2, 0.2, {}, { o: 0, s: 0.6 }, "in"));
  tl.tween(left, d, 0.4, {}, { x: -900, r: -20, o: 0 }, "in");
  tl.tween(right, d, 0.4, {}, { x: 900, r: 20, o: 0 }, "in");
  tl.tween(mid, d, 0.5, {}, { s: 0.74, y: 70 }, "inOut");
  tl.tween(mid, d + 0.05, 0.22, { "--ry": 0 }, { "--ry": 90 }, "in").tween(mid, d + 0.27, 0.32, { "--ry": -90 }, { "--ry": -8 }, "out");
  swap(mid, 0, 1, d + 0.27);
  sound("whoosh", d);
  wipe5.style.setProperty("--wx", "540px"); wipe5.style.setProperty("--wy", "1200px");
  tl.tween(wipe5, d + 0.05, 0.6, { "--wipe": 0 }, { "--wipe": 2400 }, "inOut");
  tl.tween(cap4, d, 0.25, {}, { o: 0, y: -60 }, "in");
  words(tl, cap5.querySelector(".h"), d + 0.4, 0.05);
  sound("pop", d + 0.45);
  pop(tl, stk5, d + 1.2, { s: 0.3, r: -18 });
  sound("pop", d + 1.22);
  tl.tween(mid, d + 1.0, 1.6, {}, { "--ry": 6, "--rx": 4 }, "inOut");

  /* ---- 6. the address (16.2 – 20 s) ---- */
  const e = d + 2.8;
  swipe(S4, S6, e);
  pop(tl, main.querySelector(".cta-logo"), e + 0.22, { s: 0.2, r: -60, dur: 0.6 });
  sound("pop", e + 0.27);
  let t = words(tl, main.querySelector(".h"), e + 0.32, 0.05);
  for (const li of main.querySelectorAll(".ticks li")) { tl.tween(li, t, 0.35, { o: 0, x: -50 }, { o: 1, x: 0 }, "out"); sound("tick", t); t += 0.15; }
  pop(tl, url, t + 0.05, { s: 0.3, r: 8 });
  sound("pop", t + 0.08);
  tl.tween(main.querySelector(":scope > .p"), t + 0.3, 0.4, { o: 0, y: 30 }, { o: 1, y: 0 }, "out");
  [...sparkles.children].forEach((sp, k) => pop(tl, sp, e + 0.6 + k * 0.1, { s: 0, r: -90, dur: 0.6 }));
  const press = t + 0.9;
  tl.tween(tapCta, press, 0.14, { o: 0, s: 0.4 }, { o: 1, s: 1 }, "out").tween(tapCta, press + 0.14, 0.45, {}, { o: 0, s: 1.7 }, "out");
  tl.tween(url, press, 0.1, {}, { s: 0.94 }, "out").tween(url, press + 0.1, 0.35, {}, { s: 1 }, "back");
  sound("tick", press);
  const beat = press + 0.6;
  tl.each((now) => { if (now > beat) url.style.scale = String(1 + 0.045 * Math.sin((now - beat) * 5.5) ** 2); });

  // Ambient: every scene's texture drifts and its disc floats.
  const layers = [...all.querySelectorAll(".sc, .bg")];
  tl.each((now) => layers.forEach((l, k) => {
    l.querySelector(":scope > .tex").style.translate = `${-now * 9}px ${-now * 6}px`;
    l.querySelector(":scope > .disc").style.translate = `0 ${Math.sin(now * 0.7 + k) * 18}px`;
  }));

  return { length: beat + 1.6, cover: 0.6, sfx };
}

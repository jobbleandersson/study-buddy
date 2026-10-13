// The showcase videos: PluggEra's real screens on a phone (phone.js; the shots come from
// capture-showcase.mjs), with the copy from the specs in videos.mjs. Two stories:
//   showcase — the calm tour (~34 s): "Plugga smartare, inte längre." fills the screen and shrinks onto
//              the caption line as the phone rises; then the front page, the library, a question with
//              its explanation, Högskoleprovet, the formula search, PluggEra AI, the profile, the close.
//   ad       — the paid ad, staged differently: see ad.js.
//   promo    — the short cut for scrollers (~17 s): the hook is readable in the very first frame, then
//              five features at a snap with a 1/5 … 5/5 counter (the HP estimate saved for last), the
//              address, and a last half second that runs back into the first frame, so it loops.
// Each scene has its own colour, growing out of a circle; the phone zooms in where the detail is,
// fading out under the captions; and the cuts, taps and text come with sound effects (sfx.js).

import { SPARKLE, title, LAYOUTS, fit } from "./slides.js";
import { rise, pop, words, record } from "./motion.js";
import { phoneStage } from "./phone.js";
import { ad } from "./ad.js";

const CAP_TOP = 280;   // where a caption's line starts, under its chip

/** The address scene shared by both stories: logo, line, ticks, the address bouncing gently. */
function closeScene(tl, st, cta, at) {
  const main = cta.querySelector(".main");
  tl.tween(cta, at, 0, { o: 0 }, { o: 1 }, "linear");
  pop(tl, main.querySelector(".cta-logo"), at + 0.05, { s: 0.2, r: -60, dur: 0.6 });
  st.sound("pop", at + 0.1);
  let c = words(tl, main.querySelector(".h"), at + 0.2, 0.05);
  for (const li of main.querySelectorAll(".ticks li")) { tl.tween(li, c, 0.35, { o: 0, x: -50 }, { o: 1, x: 0 }, "out"); st.sound("tick", c); c += 0.16; }
  const url = main.querySelector(".url");
  pop(tl, url, c + 0.05, { s: 0.3, r: 8 });
  st.sound("pop", c + 0.08);
  rise(tl, main.querySelector(":scope > .p"), c + 0.3, 30);
  const beat = c + 0.6;
  tl.each((now) => { if (now > beat) url.style.scale = String(1 + 0.045 * Math.sin((now - beat) * 5.5) ** 2); });
  return beat;
}

async function showcase(spec, tl, st) {
  const { R, screens: S, layer, caption, wipe, capIn, capOut, push, showAt, tapAt, zoom, scrollTo, typing, sound, add, phone } = st;
  const copy = spec.copy, C = copy.scenes;
  const BG = {
    open: layer("navy", true), landing: layer("hp"), library: layer("tips"), question: layer("ak9"),
    hp: layer("countdown"), formulas: layer("formula"), ai: layer("ord"), profile: layer("tips"), close: layer("hp"),
  };
  const brand = add(`<div class="brandpill" data-series="navy"><div class="brand"><img src="../../assets/favicon.svg" alt=""><span>PluggEra</span></div></div>`);
  const hero = add(`<div class="hero" data-series="hp">${title(copy.hero, "h1", 146, 90)}</div>`);
  const capLanding = add(`<div class="cap" data-series="hp"><p class="label">${C.landing.chip}</p></div>`);
  const capNumbers = caption("hp", null, C.landing.title, CAP_TOP);
  const capLibrary = caption("tips", C.library.chip, C.library.title);
  const capQuestion = caption("ak9", C.question.chip, C.question.title);
  const capHp = caption("countdown", C.hp.chip, C.hp.title);
  const capRef = caption("formula", C.formulas.chip, C.formulas.title);
  const capAi = caption("ord", C.ai.chip, C.ai.title);
  const capProfile = caption("tips", C.profile.chip, C.profile.title);
  const close = add(`<div class="close" data-series="hp"><div class="main">${LAYOUTS.cta(copy.cta)}</div></div>`);
  const sparkles = add(`<div class="deco" data-series="hp">${SPARKLE(948, 300, 90, 8)}${SPARKLE(40, 1520, 70, 14)}${SPARKLE(880, 1320, 56, -10)}</div>`);
  S.landing.style.opacity = "1";

  await st.ready();
  const heroSize = st.fitLine(hero.querySelector(".h"), 146, 96, 560);
  fit(close.querySelector(".main"), false);
  const heroTop = Math.round(860 - hero.offsetHeight / 2);
  hero.style.top = `${heroTop}px`;

  // Opening: the line fills the screen, then shrinks onto the caption line as the phone rises.
  pop(tl, brand, 0.05, { s: 0.5 });
  sound("pop", 0.1);
  const morph = Math.max(1.9, words(tl, hero.querySelector(".h"), 0.25, 0.08) + 0.3);
  tl.tween(phone, morph + 0.2, 0.8, { y: 1500 }, { y: 0 }, "back");
  sound("whoosh", morph + 0.15);
  tl.tween(hero, morph, 0.7, { y: 0, s: 1 }, { y: CAP_TOP - heroTop, s: 88 / heroSize }, "inOut");
  tl.tween(brand, morph, 0.3, {}, { o: 0, y: -40 }, "in");
  wipe(BG.landing, morph + 0.1, 540, 1920);

  // The front page scrolls to its numbers, and the caption says them.
  let t = morph + 0.6;
  pop(tl, capLanding.querySelector(".label"), t, { s: 0.3, r: -8 });
  sound("pop", t + 0.05);
  const statsTop = 170, scrollY = R.landingStats.y - statsTop;
  scrollTo(S.landing, scrollY, t + 0.8, 1.4);
  sound("whoosh", t + 0.85);
  tl.tween(hero, t + 1.9, 0.3, {}, { o: 0, y: CAP_TOP - heroTop - 60 }, "in");
  words(tl, capNumbers.querySelector(".h"), t + 2.05, 0.06);
  sound("pop", t + 2.1);
  zoom({ ...R.landingStats, y: statsTop }, 1.45, t + 2.4, 0.5, 1060);
  t += 4.2;

  // The library, scrolling through the years.
  wipe(BG.library, t, 1080, 600);
  capOut(capLanding, t); capOut(capNumbers, t);
  capIn(capLibrary, t + 0.15);
  push(S.landing, S.library, t + 0.1);
  scrollTo(S.library, Math.max(0, Math.min(560, st.shots.shots["library-page"].h - 844)), t + 1.2, 1.5);
  t += 3.4;

  // A question: the right answer tapped, checked, and the explanation up close.
  wipe(BG.question, t, 0, 1200);
  capOut(capLibrary, t);
  capIn(capQuestion, t + 0.15);
  push(S.library, S.q0, t + 0.1);
  tapAt(R.rightChoice, t + 1.2);
  showAt(S.q1, t + 1.3);
  tapAt(R.check, t + 2.0);
  showAt(S.q2, t + 2.1);
  sound("chime", t + 2.15);
  zoom(R.feedback, 1.45, t + 2.5, 1.2);
  t += 5.0;

  // Högskoleprovet and its estimate.
  wipe(BG.hp, t, 1080, 1920);
  capOut(capQuestion, t);
  capIn(capHp, t + 0.15);
  push(S.q2, S.hp, t + 0.1);
  for (const q of [S.q0, S.q1]) tl.tween(q, t + 0.1, 0, {}, { o: 0 }, "linear");
  zoom({ ...R.hpEstimate, h: 200 }, 1.55, t + 1.0, 1.2, 1060);
  sound("thump", t + 1.6);
  t += 3.9;

  // The formula collection: a search typed out, up close.
  wipe(BG.formulas, t, 0, 600);
  capOut(capHp, t);
  capIn(capRef, t + 0.15);
  push(S.hp, S.refs, t + 0.1);
  tapAt(R.refSearch, t + 0.9);
  zoom({ x: 12, y: R.refSearch.y, w: 366, h: 240 }, 1.3, t + 0.9, 1.4, 1060);
  typing(t + 1.2);
  t += 3.7;

  // PluggEra AI.
  wipe(BG.ai, t, 1080, 1200);
  capOut(capRef, t);
  capIn(capAi, t + 0.15);
  push(S.refs, S.solve, t + 0.1);
  zoom({ x: 12, y: 110, w: 366, h: 120 }, 1.4, t + 0.9, 0.8, 1060);
  t += 3.2;

  // The profile.
  wipe(BG.profile, t, 0, 1920);
  capOut(capAi, t);
  capIn(capProfile, t + 0.15);
  push(S.solve, S.profile, t + 0.1);
  zoom(R.idcard, 1.3, t + 0.9, 1.0);
  t += 3.4;

  // The close: the phone drops away and the address takes over.
  tl.tween(phone, t, 0.6, {}, { y: 1700, r: 4 }, "in");
  sound("whoosh", t);
  wipe(BG.close, t + 0.1, 540, 1100);
  capOut(capProfile, t);
  const beat = closeScene(tl, st, close, t + 0.35);
  [...sparkles.children].forEach((sp, k) => pop(tl, sp, t + 0.6 + k * 0.1, { s: 0, r: -90, dur: 0.6 }));
  return { length: beat + 1.9, cover: 1.5 };
}

async function promo(spec, tl, st) {
  const { R, screens: S, layer, caption, wipe, capIn, capOut, push, showAt, tapAt, zoom, scrollTo, typing, sound, add, phone } = st;
  const copy = spec.copy;
  const order = ["library", "question", "formulas", "ai", "hp"];
  const series = { library: "tips", question: "ak9", formulas: "formula", ai: "ord", hp: "countdown" };
  const BG = { hook: layer("hp", true) };
  for (const k of order) BG[k] = layer(series[k]);
  BG.close = layer("hp");

  const top = add(`<div class="promo-top" data-series="hp"><div class="brand"><img src="../../assets/favicon.svg" alt=""><span>PluggEra</span></div><span class="counter"><b>1</b>/${order.length}</span></div>`);
  const counter = top.querySelector(".counter"), counterN = counter.querySelector("b");
  const hook = add(`<div class="hook" data-series="hp">${title(spec.hook, "h1", 134, 84)}</div>`);
  const caps = order.map((k) => caption(series[k], null, copy.items[k], 304));
  const close = add(`<div class="close" data-series="hp"><div class="main">${LAYOUTS.cta(copy.cta)}</div></div>`);
  S.landing.style.opacity = "1";

  await st.ready({ capMax: 96 });
  st.fitLine(hook.querySelector(".h"), 134, 84, 640);
  fit(close.querySelector(".main"), false);
  // The hook's words and highlight are in place from the first frame: a scroller sees it at once.
  for (const m of hook.querySelectorAll("mark")) m.style.setProperty("--sweep", "100%");

  // 0 – 1.5 s: the hook, drifting a little, the phone peeking up with the front page.
  const HOOK = 1.5, PEEK = 470;
  tl.tween(hook, 0, HOOK, { s: 1.04 }, { s: 1 }, "out");
  tl.tween(phone, 0, HOOK, { y: PEEK + 40 }, { y: PEEK }, "out");

  // The snap into the list.
  tl.tween(hook, HOOK, 0.22, {}, { o: 0, y: -130 }, "in");
  tl.tween(phone, HOOK, 0.42, {}, { y: 0 }, "back");
  sound("whoosh", HOOK - 0.06);
  tl.tween(counter, HOOK + 0.12, 0.4, { o: 0, s: 2.2, r: -20 }, { o: 1, s: 1, r: 0 }, "out");
  sound("thump", HOOK + 0.2);

  // Five features, 2.6 s each.
  const D = 2.6, T1 = HOOK + 0.1;
  const at = (k) => T1 + k * D;
  tl.each((now) => { counterN.textContent = String(Math.max(1, Math.min(order.length, Math.floor((now - T1) / D) + 1))); });
  order.forEach((k, i) => {
    const t = at(i);
    wipe(BG[k], t, i % 2 ? 0 : 1080, [600, 1920, 600, 1200, 1920][i], 0.45);
    if (i) {
      capOut(caps[i - 1], t, 0.15);
      tl.tween(counter, t + 0.05, 0.3, { s: 1.3 }, { s: 1 }, "out");
      sound("tick", t + 0.05);
      tl.tween(phone, t, 0.35, {}, { x: 0, y: 0, s: 1 }, "inOut");   // out of the last zoom
    }
    capIn(caps[i], t + 0.1, 0.035);
  });

  // 1. The library.
  let t = at(0);
  push(S.landing, S.library, t, 0.35, 6);
  scrollTo(S.library, Math.max(0, Math.min(560, st.shots.shots["library-page"].h - 844)), t + 0.5, 1.0);
  // 2. A question answered, its explanation up close.
  t = at(1);
  push(S.library, S.q0, t, 0.35, 6);
  tapAt(R.rightChoice, t + 0.5);
  showAt(S.q1, t + 0.57);
  tapAt(R.check, t + 0.95);
  showAt(S.q2, t + 1.02);
  sound("chime", t + 1.05);
  zoom(R.feedback, 1.45, t + 1.2, null, 1080, 0.4);
  // 3. The formula search, typed out.
  t = at(2);
  push(S.q2, S.refs, t, 0.35, 6);
  for (const q of [S.q0, S.q1]) tl.tween(q, t, 0, {}, { o: 0 }, "linear");
  tapAt(R.refSearch, t + 0.42);
  zoom({ x: 12, y: R.refSearch.y, w: 366, h: 240 }, 1.3, t + 0.42, null, 1060, 0.4);
  typing(t + 0.6, 0.09);
  // 4. PluggEra AI.
  t = at(3);
  push(S.refs, S.solve, t, 0.35, 6);
  zoom({ x: 12, y: 110, w: 366, h: 120 }, 1.4, t + 0.5, null, 1060, 0.4);
  // 5. Högskoleprovet: the estimate, saved for last.
  t = at(4);
  push(S.solve, S.hp, t, 0.35, 6);
  zoom({ ...R.hpEstimate, h: 200 }, 1.6, t + 0.5, null, 1060, 0.4);
  sound("thump", t + 0.85);

  // The address.
  const tc = at(order.length);
  tl.tween(phone, tc, 0.35, {}, { y: 1700, r: 4 }, "in");
  sound("whoosh", tc - 0.05);
  wipe(BG.close, tc + 0.05, 540, 1100, 0.45);
  capOut(caps[order.length - 1], tc, 0.15);
  tl.tween(counter, tc, 0.2, {}, { o: 0, s: 0.6 }, "in");
  closeScene(tl, st, close, tc + 0.3);

  // Back into the first frame: the hook returns and the phone peeks up again, so the loop is seamless.
  const back = tc + 2.2, END = back + 0.45;
  tl.tween(close, back, 0.25, {}, { o: 0, y: -90 }, "in");
  sound("whoosh", back - 0.05);
  tl.tween(S.hp, back, 0, {}, { o: 0 }, "linear");
  tl.tween(S.landing, back, 0, {}, { x: 0 }, "linear");
  tl.tween(phone, back, 0.45, { x: 0, s: 1, r: 0, y: 1700 }, { x: 0, s: 1, r: 0, y: PEEK + 40 }, "out");
  tl.tween(hook, back + 0.05, 0.4, { o: 0, y: 140, s: 1.04 }, { o: 1, y: 0, s: 1.04 }, "out");
  st.loop(END);
  return { length: END, cover: 0.3 };
}

record(async (spec, tl) => {
  if (spec.kind === "ad") return ad(spec, tl);
  const st = await phoneStage(tl, document.getElementById("frame"));
  const info = await (spec.kind === "promo" ? promo : showcase)(spec, tl, st);
  return { ...info, sfx: st.sfx };
});

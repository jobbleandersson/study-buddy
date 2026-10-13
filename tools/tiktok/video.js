// TikTok videos (1080×1920, 30 fps) in the carousels' look: the same layouts from slides.js, brought to
// life by the timeline in motion.js, which render-videos.mjs steps through frame by frame. Three kinds,
// specs in videos.mjs:
//   quiz      — a hook, a real HP question against a countdown, the answer revealed, why, where to practise
//   countdown — days left to Högskoleprovet: a rolling number, three tips one by one, where to practise
//   ord       — Dagens HP-ord: the word on a flashcard against the clock, then the answer and why

import { ICON, SPARKLE, rich, topBar, title, bubble, stimulus, LAYOUTS, fit } from "./slides.js";
import { EASE, clamp, splitWords, rise, pop, leave, show, words, record } from "./motion.js";

/** The ring timer: a full ring and the seconds, draining to zero from `start`; the last three
 *  seconds turn red and beat. */
function countdown(tl, el, start, secs) {
  const arc = el.querySelector(".arc"), num = el.querySelector("b");
  const C = 2 * Math.PI * 52;
  arc.style.strokeDasharray = String(C);
  tl.each((t) => {
    const left = clamp(secs - (t - start), 0, secs);
    arc.style.strokeDashoffset = String(C * (1 - left / secs));
    num.textContent = String(Math.ceil(left - 1e-6));
    const low = left > 0 && left <= 3;
    el.classList.toggle("is-low", low);
    const beat = low ? Math.max(0, 1 - ((t - start) % 1) * 3) : 0;
    num.style.scale = String(1 + 0.35 * EASE.out(beat));
  });
}
const timerHtml = () => `<div class="timer"><svg viewBox="0 0 120 120"><circle class="trk" cx="60" cy="60" r="52"/><circle class="arc" cx="60" cy="60" r="52"/></svg><b></b></div>`;

/** Answer options; the right one carries its check mark, shown once the wrapper gets .is-answer. */
const optionRows = (choices, answer) => choices.map((c, k) =>
  `<div class="opt${k === answer ? " is-right" : ""}"><b><span class="l">${"ABCDE"[k]}</span><span class="c">${ICON.check}</span></b><span>${rich(c)}</span></div>`).join("");
const smallOptions = (choices) => choices.length > 4 || choices.some((c) => c.length > 30);

/** The moment the clock runs out: a white flash, the timer swapped for "Rätt svar: B", the wrong
 *  options greyed and the right one turned green with a little bump. */
function reveal(tl, scene, at) {
  tl.tween(scene.querySelector(".qhead .label"), at, 0.2, {}, { o: 0, x: -30 }, "in");
  const wrap = scene.querySelector(".answer-wrap"), right = scene.querySelector(".opt.is-right");
  tl.tween(scene.querySelector(".timer"), at, 0.2, {}, { o: 0, s: 0.4 }, "in");
  tl.tween(scene.querySelector(".verdict"), at + 0.08, 0.38, { o: 0, s: 2.4, r: -18 }, { o: 1, s: 1, r: 0 }, "out");
  const flash = document.querySelector(".fx-flash");
  tl.tween(flash, at, 0.06, { o: 0 }, { o: 0.35 }, "linear").tween(flash, at + 0.06, 0.4, {}, { o: 0 }, "out");
  tl.tween(right, at, 0.16, { s: 1 }, { s: 1.07 }, "out").tween(right, at + 0.16, 0.34, {}, { s: 1 }, "out");
  tl.each((t) => wrap.classList.toggle("is-answer", t >= at));
}

/** The question's options and the head row (label, timer, and the verdict sticker that replaces it). */
const questionHead = (labelText, answer) => `
  <div class="qhead">${labelText ? `<p class="label">${rich(labelText)}</p>` : "<span></span>"}${timerHtml()}<span class="verdict">Rätt svar: ${"ABCDE"[answer]}</span></div>`;

/** Reading time for a stretch of text: a base plus a little per word. */
const readTime = (text, base, perWord, min, max) => clamp(base + String(text).replace(/\$[^$]*\$/g, "x").split(/\s+/).length * perWord, min, max);

/* ---------------- the three kinds ---------------- */

const BUILD = {
  quiz(s, tl, stage) {
    const q = s.q;
    const secs = s.secs ?? Math.round(clamp(3 + readTime(`${q.prompt} ${q.choices.join(" ")} ${JSON.stringify(q.stimulus || {})}`, 0, 0.2, 0, 99), 6, 15));
    const hook = scene(stage, `
      <div class="hook-head">${s.label ? `<p class="label">${rich(s.label)}</p>` : ""}<span class="stamp stamp--time"><b>${secs}</b><small>sek</small></span></div>
      ${title(s.hook, "h1", 172, 78)}
      <p class="p">${rich(s.sub || "Svara innan tiden tar slut.")}</p>`);
    const ask = scene(stage, `
      ${questionHead(s.label, q.answer)}
      ${q.prompt ? `<p class="prompt${q.prompt.length <= 48 ? " prompt--big" : ""}">${rich(q.prompt)}</p>` : ""}
      ${stimulus(q.stimulus || {})}
      <div class="answer-wrap"><div class="card opts${smallOptions(q.choices) ? " opts--small" : ""}">${optionRows(q.choices, q.answer)}</div></div>
      ${bubble(s.ask || "Vad svarar du? Skriv i kommentarerna.")}`);
    const why = scene(stage, `
      <p class="label">Rätt svar</p>
      <div class="is-answer"><div class="card opts${smallOptions(q.choices) ? " opts--small" : ""}">${optionRows([q.choices[q.answer]], 0)}</div></div>
      <div class="card note"><h3>Därför</h3>${rich(q.explanation)}</div>
      ${bubble("Fick du rätt? Skriv i kommentarerna!")}`);
    const cta = scene(stage, LAYOUTS.cta(s.cta));
    return () => {
      // 1. The hook.
      let t = 0.15;
      rise(tl, hook.querySelector(".label"), t, 40);
      const end = words(tl, hook.querySelector(".h"), 0.3);
      pop(tl, hook.querySelector(".stamp"), end - 0.1, { s: 0.2, r: -40, dur: 0.6 });
      rise(tl, hook.querySelector(".p"), end + 0.05, 40);
      const hookEnd = Math.max(2.8, end + 1.5);
      coverAt = hookEnd - 0.3;
      leave(tl, hook, hookEnd);
      // 2. The question against the clock.
      show(tl, ask, hookEnd);
      t = hookEnd + 0.12;
      for (const el of ask.querySelectorAll(".qhead .label, .prompt, .given, .qty, .stmts")) { rise(tl, el, t, 60); t += 0.1; }
      pop(tl, ask.querySelector(".timer"), hookEnd + 0.2, { s: 0.3, r: -90 });
      rise(tl, ask.querySelector(".opts"), t, 80);
      ask.querySelectorAll(".opt").forEach((o, k) => tl.tween(o, t + 0.15 + k * 0.07, 0.35, { o: 0, x: -40 }, { o: 1, x: 0 }, "out"));
      const qStart = t + 0.5;
      pop(tl, ask.querySelector(".bubble"), qStart + 1.2, { s: 0.5 });
      countdown(tl, ask.querySelector(".timer"), qStart, secs);
      const at = qStart + secs;
      reveal(tl, ask, at);
      // 3. Why.
      const whyAt = at + 1.7;
      leave(tl, ask, whyAt);
      show(tl, why, whyAt);
      t = whyAt + 0.12;
      for (const el of why.querySelectorAll(".label, .opts, .note")) { rise(tl, el, t, 70); t += 0.14; }
      pop(tl, why.querySelector(".bubble"), t + 0.5, { s: 0.5 });
      const ctaAt = t + readTime(q.explanation, 2.2, 0.26, 4, 8);
      leave(tl, why, ctaAt);
      return ctaScene(tl, cta, ctaAt + 0.1);
    };
  },

  countdown(s, tl, stage) {
    const hook = scene(stage, `
      ${s.label || s.sticker ? `<div class="hook-head">${s.label ? `<p class="label">${rich(s.label)}</p>` : ""}${s.sticker ? `<span class="stamp">${rich(s.sticker)}</span>` : ""}</div>` : ""}
      ${s.big ? `<div class="big">${s.big}</div>` : ""}
      ${title(s.title, "h1", s.big ? 124 : 184, 78)}
      ${s.sub ? `<p class="p">${rich(s.sub)}</p>` : ""}`);
    const tips = scene(stage, LAYOUTS.text({ title: s.listTitle, list: s.list }));
    const cta = scene(stage, LAYOUTS.cta(s.cta));
    return () => {
      rise(tl, hook.querySelector(".label"), 0.15, 40);
      let t = 0.35;
      const big = hook.querySelector(".big");
      if (big) {
        // The number rolls down to the days left and lands with a thump.
        const to = Number(s.big), from = s.from ?? to + 7, roll = 1.1, rollAt = t;
        tl.tween(big, rollAt, 0.3, { o: 0, y: 60 }, { o: 1, y: 0 }, "out");
        tl.each((now) => { big.textContent = String(Math.round(from + (to - from) * EASE.out(clamp((now - rollAt) / roll, 0, 1)))); });
        tl.tween(big, rollAt + roll, 0.12, { s: 1 }, { s: 1.14 }, "out").tween(big, rollAt + roll + 0.12, 0.35, {}, { s: 1 }, "back");
        t += roll + 0.3;
      }
      const end = words(tl, hook.querySelector(".h"), t);
      if (s.sticker) pop(tl, hook.querySelector(".stamp"), end - 0.1, { s: 0.2, r: -40, dur: 0.6 });
      if (s.sub) rise(tl, hook.querySelector(".p"), end, 40);
      if (s.burst) burst(tl, end - 0.4);
      const tipsAt = Math.max(3.4, end + 1.6);
      coverAt = tipsAt - 0.3;
      leave(tl, hook, tipsAt);
      show(tl, tips, tipsAt);
      t = words(tl, tips.querySelector(".h"), tipsAt + 0.15, 0.05);
      for (const li of tips.querySelectorAll(".list li")) {
        tl.tween(li, t, 0.4, { o: 0, x: -60 }, { o: 1, x: 0 }, "out");
        pop(tl, li.querySelector("b"), t + 0.05, { s: 0.3, r: -30 });
        t += readTime(li.textContent, 0.6, 0.16, 1.2, 2.2);
      }
      const ctaAt = t + 1.2;
      leave(tl, tips, ctaAt);
      return ctaScene(tl, cta, ctaAt + 0.1);
    };
  },

  ord(s, tl, stage) {
    const card = (small) => `<div class="card flash${small ? " flash--small" : ""}"><h1 class="word">${rich(s.word)}</h1><p>${small ? "betyder ungefär …" : "Vilket ligger närmast i betydelse?"}</p></div>`;
    const ask = scene(stage, `
      ${questionHead("ORD · Ordförståelse", s.answer)}
      ${card(false)}
      <div class="answer-wrap"><div class="card opts">${optionRows(s.choices, s.answer)}</div></div>
      ${bubble("Svara i kommentarerna")}`);
    const why = scene(stage, `
      <p class="label">Svaret</p>
      ${card(true)}
      <div class="is-answer"><div class="card opts">${optionRows([s.choices[s.answer]], 0)}</div></div>
      ${s.explanation ? `<div class="card note"><h3>Därför</h3>${rich(s.explanation)}</div>` : ""}
      <span class="btn btn--small">${ICON.link}Öva fler HP-ord på pluggera.se/hp</span>`);
    return () => {
      rise(tl, ask.querySelector(".label"), 0.15, 40);
      pop(tl, ask.querySelector(".timer"), 0.3, { s: 0.3, r: -90 });
      tl.tween(ask.querySelector(".flash"), 0.3, 0.6, { o: 0, s: 0.3, r: -14 }, { o: 1, s: 1, r: 0 }, "back");
      rise(tl, ask.querySelector(".opts"), 0.85, 80);
      ask.querySelectorAll(".opt").forEach((o, k) => tl.tween(o, 1.0 + k * 0.07, 0.35, { o: 0, x: -40 }, { o: 1, x: 0 }, "out"));
      const qStart = 1.5;
      coverAt = qStart + 0.8;
      pop(tl, ask.querySelector(".bubble"), qStart + 1.0, { s: 0.5 });
      countdown(tl, ask.querySelector(".timer"), qStart, s.secs);
      const at = qStart + s.secs;
      reveal(tl, ask, at);
      const whyAt = at + 1.7;
      leave(tl, ask, whyAt);
      show(tl, why, whyAt);
      let t = whyAt + 0.12;
      for (const el of why.querySelectorAll(".label, .flash, .opts, .note")) { rise(tl, el, t, 70); t += 0.14; }
      pop(tl, why.querySelector(".btn"), t + 0.3, { s: 0.5 });
      return t + readTime(s.explanation || "", 2.4, 0.26, 4, 7);
    };
  },
};

/** The last scene: the logo, the title, the ticks, and the address bouncing gently. */
function ctaScene(tl, cta, at) {
  show(tl, cta, at);
  pop(tl, cta.querySelector(".cta-logo"), at, { s: 0.2, r: -60, dur: 0.6 });
  let t = words(tl, cta.querySelector(".h"), at + 0.25, 0.05);
  for (const li of cta.querySelectorAll(".ticks li")) { tl.tween(li, t, 0.35, { o: 0, x: -50 }, { o: 1, x: 0 }, "out"); t += 0.16; }
  const url = cta.querySelector(".url");
  pop(tl, url, t + 0.05, { s: 0.3, r: 8 });
  const sub = cta.querySelector(".cta-sub") || cta.querySelector(":scope > .p");
  rise(tl, sub, t + 0.35, 30);
  const beatFrom = t + 0.7;
  tl.each((now) => { if (now > beatFrom) url.style.scale = String(1 + 0.045 * Math.sin((now - beatFrom) * 5.5) ** 2); });
  return beatFrom + 2.6;
}

/** Sparkles bursting out across the frame (the "Lycka till" video). */
function burst(tl, at) {
  const deco = document.querySelector(".deco");
  const spots = [[120, 520, 80], [820, 300, 64], [700, 820, 54], [160, 980, 60], [880, 1180, 90], [420, 260, 46], [520, 1300, 56], [60, 1340, 44]];
  spots.forEach(([x, y, size], k) => {
    deco.insertAdjacentHTML("beforeend", SPARKLE(x, y, size, k * 25));
    pop(tl, deco.lastElementChild, at + k * 0.07, { s: 0, r: -90, dur: 0.6 });
  });
}

function scene(stage, html) {
  stage.insertAdjacentHTML("beforeend", `<div class="main">${html}</div>`);
  return stage.lastElementChild;
}

/* ---------------- recording ---------------- */

let coverAt = 2;

record(async (spec, tl) => {
  document.body.dataset.series = spec.series || "hp";
  const frame = document.getElementById("frame");
  frame.innerHTML = `<div class="tex"></div><div class="disc"></div>
    <div class="deco"><div class="ring"></div>${SPARKLE(948, 420, 96, 8)}${SPARKLE(870, 560, 50, -12)}${SPARKLE(34, 1520, 70, 14)}</div>
    ${topBar(spec)}<div class="stage"></div><div class="foot"><span class="site">pluggera.se</span></div><div class="fx-flash"></div>`;
  const stage = frame.querySelector(".stage");
  const plan = BUILD[spec.kind](spec, tl, stage);
  await document.fonts.ready;
  // Words are wrapped before measuring, so the sizes fit what is animated.
  stage.querySelectorAll(".h").forEach(splitWords);
  for (const w of stage.querySelectorAll(".word")) {
    let size = parseFloat(getComputedStyle(w).fontSize);
    while (w.scrollWidth > w.clientWidth && size > 64) w.style.fontSize = `${(size -= 4)}px`;
  }
  const fits = [...stage.children].map((main) => {
    const scale = fit(main, !main.querySelector(".cta-logo, .big, .hook-head"));
    return { fits: main.scrollHeight <= main.clientHeight + 2, scale };
  });
  // The frame around the scenes: badge and logo pop in, and the background keeps drifting.
  pop(tl, frame.querySelector(".brand"), 0, { s: 0.5 });
  pop(tl, frame.querySelector(".series"), 0.08, { s: 0.3, r: 20 });
  tl.tween(frame.querySelector(".ring"), 0, 0.6, { s: 0.2, o: 0 }, { s: 1, o: 1 }, "back");
  const tex = frame.querySelector(".tex"), disc = frame.querySelector(".disc"), ring = frame.querySelector(".ring");
  const sparkles = [...frame.querySelectorAll(".deco > svg")].slice(0, 3);
  tl.each((t) => {
    tex.style.translate = `${-t * 9}px ${-t * 6}px`;
    disc.style.translate = `0 ${Math.sin(t * 0.7) * 18}px`;
    ring.style.rotate = `${t * 6}deg`;
    sparkles.forEach((sp, k) => {
      const grow = EASE.back(clamp((t - 0.2 - k * 0.12) / 0.5, 0, 1));
      sp.style.scale = String(grow * (1 + 0.14 * Math.sin(t * 2.6 + k * 2)));
      sp.style.rotate = `${t * 14 * (k % 2 ? -1 : 1)}deg`;
    });
  });
  return { length: plan(), fits, cover: coverAt };
});

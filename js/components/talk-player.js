// "Lyssna som samtal": a dialog that writes (once, with AI) and then plays a two-person conversation
// about a set, using the device's own speech voices. Scripts are cached per set, so playing it again
// costs nothing. See lib/podcast.js for the script format and the cache.

import { el, clear, icon, ICONS, toast } from "../lib/dom.js";
import { store } from "../store.js";
import { t } from "../lib/i18n.js";
import { generateTalkScript, ClaudeError } from "../claude.js";
import { materialFromSet } from "../lib/chat-material.js";
import { scriptKey, loadScript, saveScript, estimateMinutes } from "../lib/podcast.js";
import { speechSupported, speakTalkLine, stopSpeaking, talkVoices } from "../lib/speech.js";
import { talkVoicePicker } from "./voice-controls.js";

const SPEAKERS = { A: { name: "Alex", letter: "A" }, S: { name: "Sam", letter: "S" } };
const SPEEDS = [1, 1.25, 0.85];

let dialogEl = null;
let stopPlayback = () => {};
function onEsc(e) { if (e.key === "Escape") closeTalk(); }

export function closeTalk() {
  stopPlayback();
  dialogEl?.remove();
  dialogEl = null;
  document.removeEventListener("keydown", onEsc);
}

export function openTalk(assignment) {
  closeTalk();
  const key = scriptKey(assignment);
  const body = el("div.talk__body");
  dialogEl = el("div.modal", {
    role: "dialog", "aria-modal": "true", "aria-label": t("talk.title", { title: assignment.title }),
    onclick: (e) => { if (e.target === dialogEl) closeTalk(); },
  }, [
    el("div.modal__card.talk", {}, [
      el("div.talk__head", {}, [
        el("h3", {}, t("talk.title", { title: assignment.title })),
        el("button.iconbtn.iconbtn--sm", { type: "button", "aria-label": t("common.close"), onclick: closeTalk }, icon(ICONS.close, 16)),
      ]),
      body,
    ]),
  ]);
  document.body.appendChild(dialogEl);
  document.addEventListener("keydown", onEsc);

  const cached = loadScript(key);
  if (cached) showPlayer(body, cached, assignment, key);
  else showCreate(body, assignment, key);
  (body.querySelector("button") || dialogEl.querySelector("button"))?.focus();
}

function showCreate(body, assignment, key) {
  clear(body);
  const blocked = !store.canUseAI();
  const btn = el("button.btn", {
    type: "button", disabled: blocked,
    onclick: async () => {
      btn.disabled = true;
      note.textContent = t("talk.creating");
      note.classList.remove("note--warn");
      try {
        const script = await generateTalkScript({ material: materialFromSet(assignment) });
        saveScript(key, script);
        if (!dialogEl) return;
        showPlayer(body, script, assignment, key);
      } catch (err) {
        if (!dialogEl) return;
        btn.disabled = false;
        note.textContent = err instanceof ClaudeError ? err.message : t("talk.err");
        note.classList.add("note--warn");
      }
    },
  }, [icon(ICONS.headphones, 16), t("talk.create")]);
  const note = el("p.note" + (blocked ? ".note--warn" : ""), { role: "status" }, blocked ? t("talk.needAi") : t("talk.lead"));
  body.append(note, el("div.talk__actions", {}, [btn]));
}

function showPlayer(body, script, assignment, key) {
  clear(body);
  const lines = script.lines;
  const canSpeak = speechSupported();
  const twoVoices = canSpeak && !!talkVoices()[1];
  let index = 0;
  let playing = false;
  let token = 0;
  let speedIx = 0;

  const lineEls = lines.map((l, i) => el("li.talk__line", {}, el("button", {
    type: "button", "aria-label": t("talk.line", { n: i + 1, total: lines.length }),
    onclick: () => { index = i; if (playing) playFrom(i); else paint(); },
  }, [el("b", {}, SPEAKERS[l.who].name), l.text])));
  const list = el("ol.talk__lines", {}, lineEls);
  const who = ["A", "S"].map((k) => el("div.talk__who", { "data-who": k }, [
    el("span.talk__avatar.talk__avatar--" + k.toLowerCase(), {}, SPEAKERS[k].letter),
    SPEAKERS[k].name,
  ]));
  const playBtn = el("button.iconbtn.talk__play", { type: "button", onclick: () => (playing ? pause() : playFrom(index)) });
  const speedBtn = el("button.talk__speed", { type: "button", onclick: () => { speedIx = (speedIx + 1) % SPEEDS.length; paint(); if (playing) playFrom(index); } });

  function paint() {
    lineEls.forEach((li, i) => { li.classList.toggle("is-cur", i === index); if (i === index) li.firstChild.setAttribute("aria-current", "true"); else li.firstChild.removeAttribute("aria-current"); });
    who.forEach((w) => w.classList.toggle("is-on", playing && w.dataset.who === lines[index].who));
    clear(playBtn);
    playBtn.appendChild(icon(playing ? ICONS.pause : ICONS.play, 20));
    playBtn.setAttribute("aria-label", playing ? t("talk.pause") : t("talk.play"));
    speedBtn.textContent = `${SPEEDS[speedIx]}x`;
    speedBtn.setAttribute("aria-label", t("talk.speed", { n: SPEEDS[speedIx] }));
    lineEls[index].scrollIntoView?.({ block: "nearest" });
  }

  function pause() {
    playing = false;
    token += 1;
    stopSpeaking();
    paint();
  }

  function playFrom(i) {
    index = Math.max(0, Math.min(lines.length - 1, i));
    playing = true;
    const mine = ++token;
    paint();
    const ok = speakTalkLine(lines[index].text, lines[index].who === "S" ? 1 : 0, {
      rate: SPEEDS[speedIx],
      onend: () => {
        if (mine !== token || !playing) return;
        if (index + 1 < lines.length) playFrom(index + 1);
        else { playing = false; index = 0; paint(); toast(t("talk.done")); }
      },
      onerror: (e) => { if (mine === token && e?.error !== "interrupted" && e?.error !== "canceled") pause(); },
    });
    if (!ok) pause();
  }

  const skip = (delta) => () => { const next = Math.max(0, Math.min(lines.length - 1, index + delta)); if (playing) playFrom(next); else { index = next; paint(); } };
  stopPlayback = () => { playing = false; token += 1; stopSpeaking(); };

  if (!canSpeak) { playBtn.disabled = true; }
  // Pick a voice for Alex and one for Sam, in place - it applies from the next line, so it can be done
  // while the conversation is playing.
  const voicesPanel = canSpeak ? el("div.talk__voices", { hidden: true }, [talkVoicePicker()]) : null;
  const voicesBtn = el("button.talk__speed", {
    type: "button", "aria-expanded": "false",
    onclick: () => {
      const open = voicesPanel.hidden;
      voicesPanel.hidden = !open;
      voicesBtn.setAttribute("aria-expanded", String(open));
      voicesBtn.classList.toggle("is-on", open);
    },
  }, t("talk.voices"));
  body.append(...[
    canSpeak ? null : el("p.note.note--warn", {}, t("talk.noSpeech")),
    el("div.talk__meta", {}, [t("talk.minutes", { n: estimateMinutes(lines) })]),
    el("div.talk__cast", {}, who),
    list,
    el("div.talk__ctl", {}, [
      el("button.iconbtn", { type: "button", "aria-label": t("talk.prev"), onclick: skip(-1) }, icon(ICONS.skipBack, 18)),
      playBtn,
      el("button.iconbtn", { type: "button", "aria-label": t("talk.next"), onclick: skip(1) }, icon(ICONS.skipForward, 18)),
      speedBtn,
      ...(canSpeak ? [voicesBtn] : []),
    ]),
    voicesPanel,
    el("p.note.talk__hint", {}, [t("talk.hint"), canSpeak && !twoVoices ? ` ${t("talk.oneVoice")}` : ""].join("")),
    el("button.linkbtn", {
      type: "button",
      onclick: () => { stopPlayback(); showCreate(body, assignment, key); },
    }, t("talk.again")),
  ].filter(Boolean));
  paint();
}

// The read-aloud voice controls, shared by Settings and the reading popover: a voice list (best first,
// "Natural" and "online" marked), a play-sample button, a speed slider, and - when the voice in use is a
// basic one - a tip on how to get a better one on this OS. Everything is stored through speech.js, the
// same localStorage keys the questions and the tutor read, so the two places stay in step.

import { el } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import {
  voicesForLang, rankVoices, voiceIsNatural, voiceIsOnline, voiceAdvice,
  getPreferredVoiceURI, setPreferredVoiceURI, getRate, setRate, speakSample, stopSpeaking,
} from "../lib/speech.js";

const RATE_MIN = 0.6, RATE_MAX = 1.4, RATE_STEP = 0.1;

/** The controls as one element; the caller only decides where it goes. `compact` is the popover size. */
export function voiceControls({ compact = false } = {}) {
  const root = el("div.voicectl" + (compact ? ".voicectl--compact" : ""));
  const sel = el("select.reading__voice", { "aria-label": t("read.voice") });
  const sampleBtn = el("button.btn.btn--ghost.btn--sm", { type: "button" }, t("voice.sample"));
  const rateIn = el("input", {
    type: "range", min: String(RATE_MIN), max: String(RATE_MAX), step: String(RATE_STEP),
    "aria-label": t("voice.speed"),
  });
  const rateVal = el("output.voicectl__rate", { "aria-hidden": "true" });
  const tip = el("p.note.voicectl__tip", { hidden: true });
  const onlineNote = el("p.note.voicectl__tip", { hidden: true }, t("voice.onlineNote"));
  const none = el("p.note", { hidden: true }, t("voice.none"));
  const controls = el("div.voicectl__body", {}, [
    sel,
    el("div.voicectl__row", {}, [sampleBtn, el("label.voicectl__speed", {}, [el("span", {}, t("voice.speed")), rateIn, rateVal])]),
  ]);
  root.append(controls, none, tip, onlineNote);

  // Which sample is playing: a newer one ignores an older one's "ended" (Chrome reports the cancelled one).
  let playing = 0;
  const idle = () => { sampleBtn.textContent = t("voice.sample"); };
  function play() {
    const mine = ++playing;
    sampleBtn.textContent = t("voice.stop");
    const ok = speakSample(t("voice.sampleText"), {
      voiceURI: sel.value, rate: getRate(), onend: () => { if (mine === playing) idle(); },
    });
    if (!ok) idle();
  }
  function stop() { playing++; stopSpeaking(); idle(); }

  function paintVoices() {
    const voices = rankVoices(voicesForLang());
    const want = getPreferredVoiceURI();
    sel.replaceChildren(
      el("option", { value: "" }, t("voice.auto")),
      ...voices.map((v) => el("option", { value: v.voiceURI }, [
        v.name,
        voiceIsNatural(v) ? ` · ${t("voice.natural")}` : "",
        voiceIsOnline(v) ? ` · ${t("voice.online")}` : "",
      ].join(""))),
    );
    sel.value = voices.some((v) => v.voiceURI === want) ? want : "";
    controls.hidden = !voices.length;
    none.hidden = voices.length > 0;
    onlineNote.hidden = !voices.some(voiceIsOnline);
  }

  function paintTip() {
    const a = voiceAdvice();
    tip.hidden = a.kind !== "pick-natural" && a.kind !== "install";
    if (a.kind === "pick-natural") tip.textContent = t("voice.tipPick");
    else if (a.kind === "install") tip.textContent = `${t("voice.tipBasic")} ${t(`voice.tip_${a.platform}`)}`;
  }

  sel.addEventListener("change", () => { setPreferredVoiceURI(sel.value); paintTip(); play(); });
  sampleBtn.addEventListener("click", () => (playing && sampleBtn.textContent === t("voice.stop") ? stop() : play()));
  rateIn.value = String(getRate());
  const paintRate = () => { rateVal.textContent = `${Number(rateIn.value).toFixed(1)}×`; };
  paintRate();
  rateIn.addEventListener("input", () => { setRate(Number(rateIn.value)); paintRate(); });
  rateIn.addEventListener("change", play);   // let go of the slider: hear the new speed

  paintVoices();
  paintTip();

  // Chrome loads voices a moment after the page does; repaint when they arrive, and let go of the
  // listener once this element has been shown and then removed (a closed popover).
  let seen = false;
  const onVoices = () => {
    if (root.isConnected) { seen = true; paintVoices(); paintTip(); }
    else if (seen) window.speechSynthesis?.removeEventListener?.("voiceschanged", onVoices);
  };
  try { window.speechSynthesis?.addEventListener?.("voiceschanged", onVoices); } catch { /* no speech support */ }

  return root;
}

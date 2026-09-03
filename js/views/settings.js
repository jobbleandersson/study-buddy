// Settings: look & feel, AI (tutor server + models), account, demo content,
// your data, roadmap.

import { store } from "../store.js";
import { el, clear, toast, icon, ICONS } from "../lib/dom.js";
import { localDayKey } from "../lib/activity.js";
import { PRESETS, DEFAULT_PRESET } from "../claude.js";
import { THEMES, getTheme, setTheme } from "../lib/theme.js";
import { getFont, setFont, getTextSize, setTextSize } from "../lib/typeface.js";
import { LANGS, getLang, setLang, t, plural } from "../lib/i18n.js";
import { homeButton } from "../components/nav.js";
import { confirmDialog } from "../components/confirm-dialog.js";
import { playFanfare } from "../lib/sound.js";

export function renderSettings() {
  const s = store.settings;

  /* ---------------- appearance ---------------- */
  const themeSel = el("select", { "aria-label": t("set.theme") },
    THEMES.map(([v]) => opt(v, t(`set.theme${v[0].toUpperCase()}${v.slice(1)}`))));
  themeSel.value = getTheme();
  themeSel.addEventListener("change", () => { setTheme(themeSel.value); toast(t("set.themeUpdated")); });

  const fontSel = el("select", { "aria-label": t("set.font") }, [
    opt("system", t("set.fontSystem")),
    opt("hyperlegible", t("set.fontHyperlegible")),
  ]);
  fontSel.value = getFont();
  fontSel.addEventListener("change", () => { setFont(fontSel.value); toast(t("set.saved")); });

  const sizeSel = el("select", { "aria-label": t("set.textSize") }, [
    opt("s", t("set.textSizeS")),
    opt("m", t("set.textSizeM")),
    opt("l", t("set.textSizeL")),
  ]);
  sizeSel.value = getTextSize();
  sizeSel.addEventListener("change", () => { setTextSize(sizeSel.value); toast(t("set.saved")); });

  const langSel = el("select", { "aria-label": t("set.language") },
    LANGS.map(([v, label]) => opt(v, label)));
  langSel.value = getLang();
  // setLang fires sb:langchange, which re-renders the whole app — so the toast
  // has to be queued after that render, not before it.
  langSel.addEventListener("change", () => {
    const chosen = langSel.value;
    setLang(chosen);
    setTimeout(() => toast(t("set.langUpdated")), 0);
  });

  /* ---------------- model preset ---------------- */
  const presetHint = el("p.note", { style: { marginTop: "6px" } });
  const presetSel = el("select", { "aria-describedby": "preset-hint", "aria-label": t("set.qualityCost") },
    Object.entries(PRESETS).map(([k, p]) => opt(k, t(p.labelKey))));
  presetSel.value = PRESETS[s.preset] ? s.preset : DEFAULT_PRESET;

  const presetDetail = el("div.preset-detail");
  function paintPreset() {
    const p = PRESETS[presetSel.value];
    presetHint.textContent = t(p.hintKey);
    clear(presetDetail);
    presetDetail.appendChild(el("table.preset-table", {}, [
      el("tbody", {}, [
        presetRow(t("set.jobWriting"), p.generate, t("set.whenPerSet")),
        presetRow(t("set.jobTutoring"), p.tutor, t("set.whenEveryMsg")),
        presetRow(t("set.jobMarking"), p.grade, t("set.whenEveryAnswer")),
      ]),
    ]));
  }
  function presetRow(job, model, when) {
    return el("tr", {}, [el("th", {}, job), el("td", {}, prettyModel(model)), el("td.note", {}, when)]);
  }
  presetSel.addEventListener("change", () => {
    store.setSettings({ preset: presetSel.value });
    paintPreset();
    toast(t("set.presetUpdated"));
  });
  paintPreset();

  const verbSel = el("select", { "aria-label": t("set.replyLength") }, [
    opt("concise", t("set.verbConcise")),
    opt("normal", t("set.verbNormal")),
    opt("detailed", t("set.verbDetailed")),
  ]);
  verbSel.value = s.tutorVerbosity || "normal";
  verbSel.addEventListener("change", () => {
    store.setSettings({ tutorVerbosity: verbSel.value });
    toast(t("set.tutorStyleUpdated"));
  });

  /* ---------------- sound ---------------- */
  const soundSel = el("select", { "aria-label": t("set.sound") }, [
    opt("on", t("set.soundOn")),
    opt("off", t("set.soundOff")),
  ]);
  soundSel.value = s.sound === false ? "off" : "on";
  soundSel.addEventListener("change", () => {
    const on = soundSel.value === "on";
    store.setSettings({ sound: on });
    toast(t("set.soundUpdated"));
    // Turning it on should demonstrate what "on" sounds like.
    if (on) playFanfare();
  });

  const goalInput = el("input", {
    type: "number", min: "0", max: "100", inputmode: "numeric",
    value: String(s.dailyGoal ?? 10), "aria-label": t("set.dailyGoal"),
  });
  goalInput.addEventListener("change", () => {
    const n = Math.max(0, Math.min(100, Math.round(Number(goalInput.value) || 0)));
    goalInput.value = String(n);
    store.setSettings({ dailyGoal: n });
    toast(t("set.dailyGoalUpdated"));
  });

  /* ---------------- studying ---------------- */
  const hintsSel = el("select", { "aria-label": t("set.testHints") }, [
    opt("0", t("set.testHints0")),
    opt("1", t("set.testHints1")),
    opt("2", t("set.testHints2")),
    opt("3", t("set.testHints3")),
  ]);
  hintsSel.value = String(s.testHints ?? 2);
  hintsSel.addEventListener("change", () => {
    store.setSettings({ testHints: Number(hintsSel.value) });
    toast(t("set.saved"));
  });

  const adaptiveSel = el("select", { "aria-label": t("set.adaptive") }, [
    opt("on", t("set.adaptiveOn")),
    opt("off", t("set.adaptiveOff")),
  ]);
  adaptiveSel.value = s.adaptive === false ? "off" : "on";
  adaptiveSel.addEventListener("change", () => {
    store.setSettings({ adaptive: adaptiveSel.value === "on" });
    toast(t("set.saved"));
  });

  const pomoSel = el("select", { "aria-label": t("set.pomodoro") }, [
    opt("off", t("set.pomodoroOff")),
    opt("25", t("set.pomodoro25")),
    opt("50", t("set.pomodoro50")),
  ]);
  pomoSel.value = String(s.pomodoro || "off");
  pomoSel.addEventListener("change", () => {
    store.setSettings({ pomodoro: pomoSel.value });
    toast(t("set.saved"));
  });

  const voiceSupported = "speechSynthesis" in window;
  const voiceSel = el("select", { "aria-label": t("set.voice"), disabled: !voiceSupported }, [
    opt("off", t("set.voiceOff")),
    opt("on", t("set.voiceOn")),
  ]);
  voiceSel.value = s.voice === true ? "on" : "off";
  voiceSel.addEventListener("change", () => {
    store.setSettings({ voice: voiceSel.value === "on" });
    toast(t("set.saved"));
  });

  /* ---------------- tutor server status ---------------- */
  // The Claude key lives in the backend proxy now, so there's nothing to type
  // here — just whether live mode is available.
  const serverStatus = !store.proxyUp ? t("set.serverDown")
    : !store.proxyKeyConfigured ? t("set.serverNoKey")
    : t("set.serverLive");

  const node = el("div.settings", {}, [
    homeButton({ grid: true }),
    el("h1", {}, t("set.title")),

    el("section.panel", {}, [
      el("h3", {}, t("set.lookFeel")),
      el("div.settings__row", {}, [
        el("label.field", {}, [el("span", {}, t("set.theme")), themeSel]),
        el("label.field", {}, [el("span", {}, t("set.language")), langSel]),
        el("label.field", {}, [el("span", {}, t("set.sound")), soundSel]),
        el("label.field", {}, [el("span", {}, t("set.dailyGoal")), goalInput]),
        el("label.field", {}, [el("span", {}, t("set.font")), fontSel]),
        el("label.field", {}, [el("span", {}, t("set.textSize")), sizeSel]),
      ]),
      el("p.note", {}, t("set.languageNote")),
      el("p.note", {}, t("set.soundNote")),
      el("p.note", {}, t("set.dailyGoalNote")),
    ]),

    el("section.panel", {}, [
      el("h3", {}, t("set.studying")),
      el("div.settings__row", {}, [
        el("label.field", {}, [el("span", {}, t("set.testHints")), hintsSel]),
        el("label.field", {}, [el("span", {}, t("set.adaptive")), adaptiveSel]),
        el("label.field", {}, [el("span", {}, t("set.pomodoro")), pomoSel]),
        el("label.field", {}, [el("span", {}, t("set.voice")), voiceSel]),
      ]),
      el("p.note", {}, t("set.testHintsNote")),
      el("p.note", {}, t("set.adaptiveNote")),
      el("p.note", {}, t("set.pomodoroNote")),
      el("p.note", {}, voiceSupported ? t("set.voiceNote") : t("set.voiceUnsupported")),
    ]),

    el("section.panel", {}, [
      el("h3", {}, t("set.aiTitle")),

      el("h4.settings__sub", {}, t("set.serverTitle")),
      el("p.note", { style: { margin: "6px 0 12px" } }, t("set.serverBody")),
      el("p.note", { style: { display: "flex", alignItems: "center", gap: "8px" } }, [
        el("span.dot", { style: { background: store.hasKey() ? "var(--ok)" : "var(--retry-ink)" } }),
        serverStatus,
      ]),

      el("h4.settings__sub", {}, t("set.modelTitle")),
      el("p.note", { style: { margin: "6px 0 12px" } }, t("set.modelIntro")),
      el("label.field", { style: { marginBottom: "6px" } }, [el("span", {}, t("set.qualityCost")), presetSel]),
      el("div", { id: "preset-hint" }, [presetHint]),
      presetDetail,
      el("label.field", { style: { marginTop: "16px", marginBottom: "0" } }, [el("span", {}, t("set.replyLength")), verbSel]),
    ]),

    accountSection(),

    demoSection(),

    el("section.panel", {}, [
      el("h3", {}, t("set.dataTitle")),
      el("p.note", { style: { margin: "6px 0 12px" } }, store.authed ? t("set.dataBodySynced") : t("set.dataBody")),
      el("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap" } }, [
        el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: exportData }, t("set.export")),
        el("button.btn.btn--ghost.btn--sm", { type: "button", style: { color: "var(--retry-ink)" }, onclick: wipe }, t("set.wipe")),
      ]),
    ]),

    el("section.roadmapbox", {}, [
      el("h3", {}, t("set.roadmap")),
      el("ul.roadmap", {}, [
        el("li", {}, t("set.roadShare")),
      ]),
    ]),

    el("a.btn.btn--ghost", { href: "#/" }, [icon(ICONS.back, 16), t("common.backToMenu")]),
  ]);

  function demoSection() {
    const status = el("p.note", { style: { margin: "6px 0 12px" } });
    const actions = el("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap" } });

    function paint() {
      const { loaded, total } = store.demoStatus;
      status.textContent = loaded === 0 ? t("set.demoNone")
        : loaded < total ? t("set.demoPartial", { loaded, total })
        : t("set.demoAll");

      clear(actions);
      if (loaded < total) {
        actions.appendChild(el("button.btn.btn--sm", {
          type: "button",
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            try {
              const n = await store.loadDemoContent();
              toast(n ? plural(n, "set.demoAddedOne", "set.demoAddedMany") : t("set.demoAlready"));
            } catch {
              toast(t("set.demoFailed"));
            }
            paint();
          },
        }, [icon(ICONS.play, 16), t(loaded ? "set.demoAddMissing" : "set.demoLoad")]));
      }
      if (loaded > 0) {
        actions.appendChild(el("button.btn.btn--ghost.btn--sm", {
          type: "button", style: { color: "var(--retry-ink)" },
          onclick: async () => {
            if (!(await confirmDialog({ message: t("set.demoRemoveConfirm"), confirmLabel: t("set.demoRemove"), danger: true }))) return;
            store.removeDemoContent();
            toast(t("set.demoRemoved"));
            paint();
          },
        }, t("set.demoRemove")));
      }
    }
    paint();

    return el("section.panel", {}, [
      el("h3", {}, t("set.demoTitle")),
      status,
      actions,
    ]);
  }

  function accountSection() {
    const status = el("p.note", { style: { margin: "6px 0 12px" } });
    const actions = el("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap" } });

    function paint() {
      status.textContent = store.authed
        ? t("set.acctSignedIn", { email: store.authEmail })
        : t("set.acctSignedOut");

      clear(actions);
      if (store.authed) {
        actions.appendChild(el("button.btn.btn--ghost.btn--sm", {
          type: "button",
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            await store.logout();
            toast(t("set.acctSignedOutToast"));
            paint();
          },
        }, t("set.acctSignOut")));
        actions.appendChild(el("a.btn.btn--ghost.btn--sm", { href: "#/parent" }, t("set.acctParentLink")));
      } else {
        actions.appendChild(el("a.btn.btn--sm", { href: "#/login" }, t("set.acctSignIn")));
      }
    }
    paint();

    return el("section.panel", {}, [
      el("h3", {}, t("set.acctTitle")),
      !store.proxyUp && el("p.note.note--warn", {}, t("set.acctNoServer")),
      status,
      actions,
    ]);
  }

  function exportData() {
    const blob = new Blob([store.exportJSON()], { type: "application/json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: `studybuddy-backup-${localDayKey()}.json` });
    document.body.appendChild(a); a.click(); a.remove();
    toast(t("set.backupDownloaded"));
  }

  async function wipe() {
    if (!(await confirmDialog({ message: t("set.wipeConfirm"), confirmLabel: t("set.wipe"), danger: true }))) return;
    store.wipe();
    toast(t("set.wiped"));
    location.hash = "#/";
  }

  return { title: t("set.title"), node };
}

function opt(value, label) { return el("option", { value }, label); }

function prettyModel(id) {
  return ({
    "claude-opus-5": "Claude Opus 5",
    "claude-sonnet-5": "Claude Sonnet 5",
    "claude-haiku-4-5": "Claude Haiku 4.5",
  })[id] || id;
}

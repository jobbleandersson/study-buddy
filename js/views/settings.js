// Settings: look & feel, AI (key + models), demo content, your data, roadmap.

import { store } from "../store.js";
import { el, clear, toast, icon, ICONS } from "../lib/dom.js";
import { localDayKey } from "../lib/activity.js";
import { PRESETS, DEFAULT_PRESET } from "../claude.js";
import { THEMES, getTheme, setTheme } from "../lib/theme.js";
import { LANGS, getLang, setLang, t, plural } from "../lib/i18n.js";
import { playFanfare } from "../lib/sound.js";

export function renderSettings() {
  const s = store.settings;

  /* ---------------- appearance ---------------- */
  const themeSel = el("select", { "aria-label": t("set.theme") },
    THEMES.map(([v]) => opt(v, t(`set.theme${v[0].toUpperCase()}${v.slice(1)}`))));
  themeSel.value = getTheme();
  themeSel.addEventListener("change", () => { setTheme(themeSel.value); toast(t("set.themeUpdated")); });

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

  /* ---------------- key ---------------- */
  const keyInput = el("input", {
    type: "password", value: s.apiKey || "", placeholder: "sk-ant-…",
    autocomplete: "off", spellcheck: "false", "aria-label": t("set.key"),
  });
  const showBtn = el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => {
    keyInput.type = keyInput.type === "password" ? "text" : "password";
    showBtn.textContent = t(keyInput.type === "password" ? "set.show" : "set.hide");
  } }, t("set.show"));
  const saveKey = el("button.btn.btn--sm", { type: "button", onclick: () => {
    store.setSettings({ apiKey: keyInput.value.trim() });
    toast(t(keyInput.value.trim() ? "set.keySaved" : "set.keyCleared"));
  } }, t("set.save"));

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

  /* Four panels, not seven. Seven identical bordered blocks in a 620px column
     made Settings 2,300px of scrolling in which nothing stood out; the things
     that belong together (how it looks and sounds; the key and the models it
     unlocks) now sit together, and the roadmap drops its panel chrome because
     it isn't a control. */
  const node = el("div.settings", {}, [
    el("h1", {}, t("set.title")),

    el("section.panel", {}, [
      el("h3", {}, t("set.lookFeel")),
      el("div.settings__row", {}, [
        el("label.field", {}, [el("span", {}, t("set.theme")), themeSel]),
        el("label.field", {}, [el("span", {}, t("set.language")), langSel]),
        el("label.field", {}, [el("span", {}, t("set.sound")), soundSel]),
      ]),
      el("p.note", {}, t("set.languageNote")),
      el("p.note", {}, t("set.soundNote")),
    ]),

    el("section.panel", {}, [
      el("h3", {}, t("set.aiTitle")),

      el("h4.settings__sub", {}, t("set.keyTitle")),
      el("p.note", { style: { margin: "6px 0 12px" } }, t("set.keyBody")),
      el("label.field", {}, [el("span", {}, t("set.key")), el("div.keyrow", {}, [keyInput, showBtn, saveKey])]),
      el("p.note.note--warn", {}, [icon(ICONS.spark, 16), t("set.keyWarning")]),
      el("p.note", { style: { marginTop: "10px" } }, [
        t("set.getKeyAt"),
        el("a", { href: "https://console.anthropic.com/settings/keys", target: "_blank", rel: "noopener" }, "console.anthropic.com"),
        t("set.billed"),
      ]),

      el("h4.settings__sub", {}, t("set.modelTitle")),
      el("p.note", { style: { margin: "6px 0 12px" } }, t("set.modelIntro")),
      el("label.field", { style: { marginBottom: "6px" } }, [el("span", {}, t("set.qualityCost")), presetSel]),
      el("div", { id: "preset-hint" }, [presetHint]),
      presetDetail,
      el("label.field", { style: { marginTop: "16px", marginBottom: "0" } }, [el("span", {}, t("set.replyLength")), verbSel]),
    ]),

    demoSection(),

    el("section.panel", {}, [
      el("h3", {}, t("set.dataTitle")),
      el("p.note", { style: { margin: "6px 0 12px" } }, t("set.dataBody")),
      el("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap" } }, [
        el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: exportData }, t("set.export")),
        el("button.btn.btn--ghost.btn--sm", { type: "button", style: { color: "var(--retry-ink)" }, onclick: wipe }, t("set.wipe")),
      ]),
    ]),

    el("section.roadmapbox", {}, [
      el("h3", {}, t("set.roadmap")),
      el("ul.roadmap", {}, [
        el("li", {}, t("set.roadVoice")),
        el("li", {}, t("set.roadAccounts")),
        el("li", {}, t("set.roadTeacher")),
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
          onclick: () => {
            if (!confirm(t("set.demoRemoveConfirm"))) return;
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

  function exportData() {
    const blob = new Blob([store.exportJSON()], { type: "application/json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: `studybuddy-backup-${localDayKey()}.json` });
    document.body.appendChild(a); a.click(); a.remove();
    toast(t("set.backupDownloaded"));
  }

  function wipe() {
    if (!confirm(t("set.wipeConfirm"))) return;
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

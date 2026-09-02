// Settings: tutor server status, model, tutor verbosity, data export/wipe, roadmap.

import { store } from "../store.js";
import { el, clear, toast, icon, ICONS } from "../lib/dom.js";
import { localDayKey } from "../lib/activity.js";
import { PRESETS, DEFAULT_PRESET } from "../claude.js";
import { THEMES, getTheme, setTheme } from "../lib/theme.js";

export function renderSettings() {
  const s = store.settings;

  const presetHint = el("p.note", { style: { marginTop: "6px" } });
  const presetSel = el("select", { "aria-describedby": "preset-hint" },
    Object.entries(PRESETS).map(([k, p]) => opt(k, p.label)));
  presetSel.value = PRESETS[s.preset] ? s.preset : DEFAULT_PRESET;

  const presetDetail = el("div.preset-detail");
  function paintPreset() {
    const p = PRESETS[presetSel.value];
    presetHint.textContent = p.hint;
    clear(presetDetail);
    presetDetail.appendChild(el("table.preset-table", {}, [
      el("tbody", {}, [
        presetRow("Writing a set", p.generate, "once per set"),
        presetRow("Tutoring you", p.tutor, "every message"),
        presetRow("Marking answers", p.grade, "every written answer"),
      ]),
    ]));
  }
  function presetRow(job, model, when) {
    return el("tr", {}, [
      el("th", {}, job),
      el("td", {}, prettyModel(model)),
      el("td.note", {}, when),
    ]);
  }
  presetSel.addEventListener("change", () => {
    store.setSettings({ preset: presetSel.value });
    paintPreset();
    toast("Model preset updated");
  });
  paintPreset();

  const verbSel = el("select", {}, [
    opt("concise", "Concise — short hints"),
    opt("normal", "Normal (default)"),
    opt("detailed", "Detailed — fuller explanations"),
  ]);
  verbSel.value = s.tutorVerbosity || "normal";
  verbSel.addEventListener("change", () => { store.setSettings({ tutorVerbosity: verbSel.value }); toast("Tutor style updated"); });

  const themeSel = el("select", { "aria-label": "Theme" },
    THEMES.map(([v, l]) => opt(v, l)));
  themeSel.value = getTheme();
  themeSel.addEventListener("change", () => { setTheme(themeSel.value); toast("Theme updated"); });

  const node = el("div.settings", {}, [
    el("h1", {}, "Settings"),

    el("section.panel", {}, [
      el("h3", {}, "Appearance"),
      el("label.field", { style: { marginTop: "12px", marginBottom: "0" } }, [
        el("span", {}, "Theme"), themeSel,
      ]),
    ]),

    el("section.panel", {}, [
      el("h3", {}, "Tutor server"),
      el("p.note", { style: { margin: "6px 0 12px" } },
        "Assignment generation and live tutoring are handled by a small backend that holds the Claude key — nothing to configure here. Without it reachable, StudyBuddy runs in demo mode on the sample content."),
      el("p.note", { style: { display: "flex", alignItems: "center", gap: "8px" } }, [
        el("span", {
          style: {
            display: "inline-block", width: "8px", height: "8px", borderRadius: "50%",
            background: store.hasKey() ? "var(--c-leaf)" : "var(--retry-ink)",
          },
        }),
        !store.proxyUp ? "Not reachable — running in demo mode"
          : !store.proxyKeyConfigured ? "Connected, but no Claude key configured — running in demo mode"
          : "Connected — live mode is on",
      ]),
    ]),

    accountSection(),

    el("section.panel", {}, [
      el("h3", {}, "Model & tutor"),
      el("p.note", { style: { margin: "6px 0 12px" } },
        "StudyBuddy uses different Claude models for different jobs, so you're not paying top rates to mark a one-line answer."),
      el("label.field", { style: { marginBottom: "6px" } }, [el("span", {}, "Quality & cost"), presetSel]),
      el("div", { id: "preset-hint" }, [presetHint]),
      presetDetail,
      el("label.field", { style: { marginTop: "16px" } }, [el("span", {}, "Tutor reply length"), verbSel]),
    ]),

    demoSection(),

    el("section.panel", {}, [
      el("h3", {}, "Your data"),
      el("p.note", { style: { margin: "6px 0 12px" } }, store.authed
        ? "Everything (assignments, attempts, progress) lives in this browser and syncs to your account."
        : "Everything (assignments, attempts, progress) lives in this browser."),
      el("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap" } }, [
        el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: exportData }, "Export JSON"),
        el("button.btn.btn--ghost.btn--sm", { type: "button", style: { color: "var(--retry-ink)" }, onclick: wipe }, "Wipe all data"),
      ]),
    ]),

    el("section.panel", {}, [
      el("h3", { style: { marginBottom: "10px" } }, "Roadmap"),
      el("ul.roadmap", {}, [
        el("li", {}, "Voice chat — talk through problems out loud"),
        el("li", {}, "Share assignment sets with a friend"),
      ]),
    ]),

    el("a.btn.btn--ghost", { href: "#/" }, [icon(ICONS.back, 16), "Back to menu"]),
  ]);

  function demoSection() {
    const status = el("p.note", { style: { margin: "6px 0 12px" } });
    const actions = el("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap" } });

    function paint() {
      const { loaded, total } = store.demoStatus;
      status.textContent = loaded === 0
        ? "Two ready-made sets (Photosynthesis Basics, Ancient Rome Quiz) you can try without an API key — the tutor works in demo mode too."
        : loaded < total
          ? `${loaded} of ${total} demo sets are in your library. You can add the missing one back, or clear them out.`
          : "Both demo sets are in your library. They behave like any other set — study, edit, or delete them.";

      clear(actions);
      if (loaded < total) {
        actions.appendChild(el("button.btn.btn--sm", {
          type: "button",
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            try {
              const n = await store.loadDemoContent();
              toast(n ? `Added ${n} demo set${n === 1 ? "" : "s"}` : "Already in your library");
            } catch {
              toast("Couldn't load the demo sets");
            }
            paint();
          },
        }, [icon(ICONS.play, 16), loaded ? "Add the missing one" : "Load demo sets"]));
      }
      if (loaded > 0) {
        actions.appendChild(el("button.btn.btn--ghost.btn--sm", {
          type: "button", style: { color: "var(--retry-ink)" },
          onclick: () => {
            if (!confirm("Remove the demo sets from your library?\n\nAny attempts you made on them stay in your history.")) return;
            store.removeDemoContent();
            toast("Demo sets removed");
            paint();
          },
        }, "Remove demo sets"));
      }
    }
    paint();

    return el("section.panel", {}, [
      el("h3", {}, "Demo content"),
      status,
      actions,
    ]);
  }

  function accountSection() {
    const status = el("p.note", { style: { margin: "6px 0 12px" } });
    const actions = el("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap" } });

    function paint() {
      status.textContent = store.authed
        ? `Signed in as ${store.authEmail}. Your library syncs to this account.`
        : "Not signed in — StudyBuddy works fully locally. Sign in to sync your library across devices.";

      clear(actions);
      if (store.authed) {
        actions.appendChild(el("button.btn.btn--ghost.btn--sm", {
          type: "button",
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            await store.logout();
            toast("Signed out — local mode");
            paint();
          },
        }, "Sign out"));
      } else {
        actions.appendChild(el("a.btn.btn--sm", { href: "#/login" }, "Sign in / create account"));
      }
      if (store.authed) {
        actions.appendChild(el("a.btn.btn--ghost.btn--sm", { href: "#/parent" }, "Parent / teacher linking"));
      }
    }
    paint();

    return el("section.panel", {}, [
      el("h3", {}, "Account"),
      status,
      actions,
    ]);
  }

  function exportData() {
    const blob = new Blob([store.exportJSON()], { type: "application/json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: `studybuddy-backup-${localDayKey()}.json` });
    document.body.appendChild(a); a.click(); a.remove();
    toast("Backup downloaded");
  }

  function wipe() {
    if (!confirm("Delete all sets, attempts, and progress?\n\nThis can't be undone. Export a backup first if you want to keep it.")) return;
    store.wipe();
    toast("Data wiped");
    location.hash = "#/";
  }

  return { title: "Settings", node };
}

function opt(value, label) { return el("option", { value }, label); }

function prettyModel(id) {
  return ({
    "claude-opus-5": "Claude Opus 5",
    "claude-sonnet-5": "Claude Sonnet 5",
    "claude-haiku-4-5": "Claude Haiku 4.5",
  })[id] || id;
}

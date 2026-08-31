// Settings: Claude API key, model, tutor verbosity, data export/wipe, roadmap.

import { store } from "../store.js";
import { el, toast, icon, ICONS } from "../lib/dom.js";

export function renderSettings() {
  const s = store.settings;

  const keyInput = el("input", { type: "password", value: s.apiKey || "", placeholder: "sk-ant-…", autocomplete: "off", spellcheck: "false" });
  const showBtn = el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => {
    keyInput.type = keyInput.type === "password" ? "text" : "password";
    showBtn.textContent = keyInput.type === "password" ? "Show" : "Hide";
  } }, "Show");
  const saveKey = el("button.btn.btn--sm", { type: "button", onclick: () => {
    store.setSettings({ apiKey: keyInput.value.trim() });
    toast(keyInput.value.trim() ? "Key saved — live tutoring is on" : "Key cleared — demo mode");
  } }, "Save");

  const modelSel = el("select", {}, [
    opt("claude-opus-5", "Claude Opus 5 — best quality (default)"),
    opt("claude-sonnet-5", "Claude Sonnet 5 — cheaper, still strong"),
    opt("claude-haiku-4-5", "Claude Haiku 4.5 — fastest & cheapest"),
  ]);
  modelSel.value = s.model || "claude-opus-5";
  modelSel.addEventListener("change", () => { store.setSettings({ model: modelSel.value }); toast("Model updated"); });

  const verbSel = el("select", {}, [
    opt("concise", "Concise — short hints"),
    opt("normal", "Normal (default)"),
    opt("detailed", "Detailed — fuller explanations"),
  ]);
  verbSel.value = s.tutorVerbosity || "normal";
  verbSel.addEventListener("change", () => { store.setSettings({ tutorVerbosity: verbSel.value }); toast("Tutor style updated"); });

  const node = el("div.settings", {}, [
    el("h1", {}, "Settings"),

    el("section.panel", {}, [
      el("h3", {}, "Claude API key"),
      el("p.note", { style: { margin: "6px 0 12px" } }, "Needed to generate assignments from your material and for live tutoring. Without it, StudyBuddy runs in demo mode on the sample content."),
      el("label.field", {}, [el("span", {}, "Key"), el("div.keyrow", {}, [keyInput, showBtn, saveKey])]),
      el("p.note.note--warn", {}, [
        icon(ICONS.spark, 16),
        " Your key is stored only in this browser (localStorage). That's fine for personal use. Don't put this app on a public website until a small backend holds the key instead — anyone visiting could otherwise use your key.",
      ]),
      el("p.note", { style: { marginTop: "10px" } }, [
        "Get a key at ", el("a", { href: "https://console.anthropic.com/settings/keys", target: "_blank", rel: "noopener" }, "console.anthropic.com"), ". Usage is billed to your Anthropic account.",
      ]),
    ]),

    el("section.panel", {}, [
      el("h3", {}, "Model & tutor"),
      el("label.field", { style: { marginTop: "12px" } }, [el("span", {}, "Model"), modelSel]),
      el("label.field", {}, [el("span", {}, "Tutor reply length"), verbSel]),
    ]),

    el("section.panel", {}, [
      el("h3", {}, "Your data"),
      el("p.note", { style: { margin: "6px 0 12px" } }, "Everything (assignments, attempts, progress) lives in this browser."),
      el("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap" } }, [
        el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: exportData }, "Export JSON"),
        el("button.btn.btn--ghost.btn--sm", { type: "button", style: { color: "var(--retry)" }, onclick: wipe }, "Wipe all data"),
      ]),
    ]),

    el("section.panel", {}, [
      el("h3", { style: { marginBottom: "10px" } }, "Roadmap"),
      el("ul.roadmap", {}, [
        el("li", {}, "Voice chat — talk through problems out loud"),
        el("li", {}, "Accounts & sync — use StudyBuddy on any device"),
        el("li", {}, "Parent / teacher view — assign work and track progress"),
        el("li", {}, "Share assignment sets with a friend"),
      ]),
    ]),

    el("a.btn.btn--ghost", { href: "#/" }, [icon(ICONS.back, 16), "Back to menu"]),
  ]);

  function exportData() {
    const blob = new Blob([store.exportJSON()], { type: "application/json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: `studybuddy-backup-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.appendChild(a); a.click(); a.remove();
    toast("Backup downloaded");
  }

  function wipe() {
    if (!confirm("Delete all assignments, attempts, and progress? The sample content will be restored. This can't be undone.")) return;
    store.wipe();
    toast("Data wiped");
    location.hash = "#/";
  }

  return { title: "Settings", node };
}

function opt(value, label) { return el("option", { value }, label); }

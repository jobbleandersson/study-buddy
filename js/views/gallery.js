// Browse the bundled sample sets and add them to your library. Keeps the demo
// experience out of the way of a real, empty library while still one tap away.

import { store, SAMPLE_FILES } from "../store.js";
import { el, icon, ICONS, toast } from "../lib/dom.js";
import { getLang, t } from "../lib/i18n.js";
import { homeButton } from "../components/nav.js";

export async function renderGallery() {
  const lang = getLang();
  const metas = await Promise.all(SAMPLE_FILES.map(async (entry) => {
    const file = entry.files[lang] || entry.files.en;
    try {
      const doc = await fetch(file).then((r) => r.json());
      return { id: entry.id, doc };
    } catch { return { id: entry.id, doc: null }; }
  }));

  const grid = el("div.gallery");

  function card({ id, doc }) {
    if (!doc) return null;
    const owned = !!store.getAssignment(id);
    const addBtn = el("button.btn.btn--sm", {
      type: "button", disabled: owned,
      onclick: async (e) => {
        e.currentTarget.disabled = true;
        await store.loadSample(id);
        toast(t("gallery.added", { title: doc.title }));
        grid.replaceChildren(...metas.map(card).filter(Boolean));
      },
    }, owned ? t("gallery.inLibrary") : [icon(ICONS.plus, 16), t("gallery.add")]);

    return el("div.gallery__card", {}, [
      el("span.badge", {}, doc.subject || t("common.general")),
      el("h3", {}, doc.title),
      el("p.note", {}, doc.sourceSummary || ""),
      el("p.note", {}, t("gallery.questions", { n: (doc.questions || []).length })),
      doc.questions?.[0]
        ? el("p.gallery__preview", { html: `“${escapeHtml((doc.questions[0].prompt || "").slice(0, 120))}”` })
        : null,
      addBtn,
    ].filter(Boolean));
  }

  grid.replaceChildren(...metas.map(card).filter(Boolean));

  const node = el("div", {}, [
    homeButton(),
    el("h1", {}, t("gallery.title")),
    el("p.note", { style: { marginBottom: "16px" } }, t("gallery.intro")),
    grid,
    el("a.btn.btn--ghost", { href: "#/", style: { marginTop: "20px" } }, [icon(ICONS.back, 16), t("common.backToMenu")]),
  ]);

  return { title: t("gallery.title"), node };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

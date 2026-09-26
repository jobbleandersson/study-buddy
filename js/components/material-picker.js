// "Välj material": the dialog behind the paperclip in Studify AI. Pick one of your own sets, or upload
// a PDF / text file, and hand it back as chat material (lib/chat-material.js).

import { el, clear, icon, ICONS, toast } from "../lib/dom.js";
import { store } from "../store.js";
import { t, plural } from "../lib/i18n.js";
import { extractPdfText } from "../material.js";
import { materialFromSet, materialFromText } from "../lib/chat-material.js";

let dialogEl = null;
function onEsc(e) { if (e.key === "Escape") closeMaterialPicker(); }

export function closeMaterialPicker() {
  dialogEl?.remove();
  dialogEl = null;
  document.removeEventListener("keydown", onEsc);
}

/** `onPick(material)` is called once, with a { kind, title, text, ... } material, and the dialog closes. */
export function openMaterialPicker({ onPick }) {
  closeMaterialPicker();

  const search = el("input", {
    type: "search", placeholder: t("solve.materialSearch"), "aria-label": t("solve.materialSearch"),
    oninput: () => paint(),
  });
  const list = el("div.matpick__list");
  const status = el("p.note", { role: "status", hidden: true });

  function pick(material) {
    closeMaterialPicker();
    onPick(material);
  }

  function paint() {
    clear(list);
    const q = search.value.trim().toLowerCase();
    const sets = store.assignments
      .filter((a) => (a.questions?.length || 0) > 0 && (!q || String(a.title || "").toLowerCase().includes(q)))
      .sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0));
    if (!sets.length) {
      list.appendChild(el("p.note", {}, store.assignments.length ? t("solve.historyNone") : t("solve.materialNoSets")));
      return;
    }
    for (const a of sets) {
      const n = a.questions.length;
      list.appendChild(el("button.matpick__item", { type: "button", onclick: () => pick(materialFromSet(a)) }, [
        icon(ICONS.book, 18),
        el("span.matpick__name", {}, [
          el("b", {}, a.title),
          el("small", {}, plural(n, "solve.materialQuestionsOne", "solve.materialQuestionsMany", { n })),
        ]),
      ]));
    }
  }

  const fileInput = el("input", {
    type: "file", accept: ".pdf,application/pdf,.txt,.md,text/plain", style: { display: "none" },
    onchange: async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      status.hidden = false;
      status.textContent = t("solve.materialReading");
      try {
        const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
        const text = isPdf ? await extractPdfText(file) : await file.text();
        if (!String(text).replace(/\s/g, "")) throw new Error("empty");
        pick(materialFromText(file.name, text));
      } catch (err) {
        status.hidden = false;
        status.textContent = t("solve.materialReadFail");
      }
    },
  });

  dialogEl = el("div.modal", {
    role: "dialog", "aria-modal": "true", "aria-label": t("solve.materialTitle"),
    onclick: (e) => { if (e.target === dialogEl) closeMaterialPicker(); },
  }, [
    el("div.modal__card.matpick", {}, [
      el("h3", { style: { marginBottom: "4px" } }, t("solve.materialTitle")),
      el("p.note", { style: { marginBottom: "12px" } }, t("solve.materialLead")),
      store.assignments.length > 6 ? el("div.matpick__search", {}, search) : null,
      list,
      status,
      fileInput,
      el("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "12px" } }, [
        el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => fileInput.click() }, [icon(ICONS.fileText, 16), t("solve.materialUpload")]),
        el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: closeMaterialPicker }, t("common.cancel")),
      ]),
    ].filter(Boolean)),
  ]);
  document.body.appendChild(dialogEl);
  document.addEventListener("keydown", onEsc);
  paint();
  (store.assignments.length > 6 ? search : list.querySelector("button"))?.focus();
}

// A subject input with one-tap chips for the subjects already in use, so a
// new set lands under the same subject as its siblings instead of a near-
// duplicate ("Science" vs "science"). Typing a new name still works.
//
// Only subjects that have at least one set are offered — the empty starter
// subjects and any orphaned leftovers stay out of the way.

import { el } from "../lib/dom.js";
import { store } from "../store.js";
import { t } from "../lib/i18n.js";

export function subjectField({ value = "", onChange } = {}) {
  const input = el("input", {
    type: "text", value,
    "aria-label": t("create.subject"),
    placeholder: t("create.subjectPlaceholder"),
    oninput: (e) => { onChange?.(e.target.value); syncChips(); },
  });

  const chipRow = el("div.subjchips", { role: "group", "aria-label": t("create.subjectExisting") });

  function syncChips() {
    const cur = input.value.trim().toLowerCase();
    [...chipRow.children].forEach((c) =>
      c.setAttribute("aria-pressed", String(c.dataset.name.toLowerCase() === cur)));
  }

  const inUse = new Set(store.assignments.map((a) => a.subjectId));
  const subjects = store.subjects.filter((s) => inUse.has(s.id) || s.pinned);

  for (const s of subjects) {
    const color = store.subjectColor(s.id);
    chipRow.appendChild(el("button.chip", {
      type: "button",
      dataset: { name: s.name },
      "aria-pressed": String(s.name.toLowerCase() === value.trim().toLowerCase()),
      style: { "--subject": color.solid, "--subject-ink": color.ink },
      onclick: () => { input.value = s.name; onChange?.(s.name); syncChips(); input.focus(); },
    }, [el("span.chip__dot"), s.name]));
  }

  const wrap = el("div.subjectfield", {}, [
    input,
    subjects.length ? chipRow : null,
  ].filter(Boolean));

  return { el: wrap, getValue: () => input.value.trim() };
}

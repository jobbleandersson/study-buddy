// The subject picker used wherever a set or a test gets a subject: a short row of subjects to tap,
// and "+ Nytt ämne", which opens a field for a name of your own. First the student's own subjects
// (the ones they have sets in, or named themselves), then the usual school subjects they don't have
// yet, so a new set lands under the same subject as its siblings instead of a near-duplicate
// ("Science" vs "science"). Högskoleprovet's delprov (ORD, XYZ, …) are not subjects to pick.
//
// Only a name comes out (getValue / onChange); the subject itself is made when the set is saved.

import { el } from "../lib/dom.js";
import { store } from "../store.js";
import { t } from "../lib/i18n.js";
import { isHpSetId } from "../lib/hp.js";

const STANDARD = ["math", "swedish", "english", "biology", "chemistry", "physics", "history", "civics", "geography", "religion"];
const VISIBLE = 8;   // chips shown before "Visa fler"

const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/** The names on offer, in order: the student's own (most sets first), then the standard ones not already among them. */
export function subjectChoices() {
  const count = new Map();
  const nonHp = new Set();
  for (const a of store.assignments) {
    count.set(a.subjectId, (count.get(a.subjectId) || 0) + 1);
    if (!isHpSetId(a.id)) nonHp.add(a.subjectId);
  }
  // A subject made only by Högskoleprovet's sets is not one to file your own work under.
  const own = store.subjects
    .filter((s) => (nonHp.has(s.id) || (s.pinned && !count.has(s.id))))
    .sort((x, y) => (count.get(y.id) || 0) - (count.get(x.id) || 0))
    .map((s) => s.name);
  const standard = STANDARD.map((k) => t(`subj.std.${k}`)).filter((n) => !own.some((o) => same(o, n)));
  return [...own, ...standard];
}

export function subjectField({ value = "", onChange } = {}) {
  const choices = subjectChoices();
  let current = value.trim();
  // A name that isn't among the choices (a locked-in or typed one) opens the new-subject field with it.
  let creating = !!current && !choices.some((c) => same(c, current));
  let showAll = false;

  const group = el("div.subjpick", { role: "group", "aria-label": t("create.subject") });
  const input = el("input.subjpick__input", {
    type: "text", value: creating ? current : "", maxlength: "40", autocomplete: "off",
    "aria-label": t("subj.newLabel"), placeholder: t("subj.newPlaceholder"),
    oninput: (e) => { current = e.target.value.trim(); onChange?.(e.target.value); syncPressed(); },
  });
  const inputWrap = el("div.subjpick__new", {}, [input]);

  function pick(name) {
    current = name; creating = false;
    onChange?.(name);
    paint();
  }

  // The first few, with the chosen one among them (it is never hidden behind "Visa fler"). Worked out
  // when the picker opens and when it folds back up, not on every tap, so the chips stay where they are.
  const firstFew = () => {
    const idx = choices.findIndex((c) => same(c, current));
    const few = choices.slice(0, VISIBLE);
    if (idx >= VISIBLE) few[VISIBLE - 1] = choices[idx];
    return few;
  };
  let few = firstFew();

  function paint() {
    const shown = showAll ? choices : few;
    const chips = shown.map((name) => el("button.subjpick__chip", {
      type: "button", dataset: { name }, "aria-pressed": String(!creating && same(name, current)),
      onclick: () => pick(name),
    }, name));
    const hidden = choices.length - shown.length;
    const extra = [];
    if (hidden > 0) extra.push(el("button.subjpick__more", { type: "button", onclick: () => { showAll = true; paint(); } }, t("subj.more", { n: hidden })));
    else if (showAll && choices.length > VISIBLE) extra.push(el("button.subjpick__more", { type: "button", onclick: () => { showAll = false; few = firstFew(); paint(); } }, t("subj.less")));
    const add = el("button.subjpick__chip.subjpick__chip--new", {
      type: "button", "aria-pressed": String(creating), "aria-expanded": String(creating),
      onclick: () => {
        creating = true; current = input.value.trim(); onChange?.(input.value); paint();
        input.focus();
      },
    }, ["+ ", t("subj.new")]);
    group.replaceChildren(...chips, add, ...extra);
    inputWrap.hidden = !creating;
  }

  /** Typing a name that is one of the chips presses that chip. */
  function syncPressed() {
    const match = choices.some((c) => same(c, current));
    group.querySelectorAll(".subjpick__chip:not(.subjpick__chip--new)").forEach((b) =>
      b.setAttribute("aria-pressed", String(match && same(b.dataset.name, current))));
  }

  paint();
  const wrap = el("div.subjectfield", {}, [group, inputWrap]);
  return { el: wrap, getValue: () => current };
}

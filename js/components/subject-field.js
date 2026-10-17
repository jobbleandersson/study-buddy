// The subject picker used wherever a set or a test gets a subject: a short row of subjects to tap,
// and "+ Nytt ämne", which opens a field for a name of your own. First the student's own subjects
// (the ones they have sets in, or named themselves), then the usual school subjects they don't have
// yet, so a new set lands under the same subject as its siblings instead of a near-duplicate
// ("Science" vs "science"). Högskoleprovet's delprov (ORD, XYZ, …) are not subjects to pick.
//
// A subject of your own (not one of the usual school subjects) can be removed again: "Ta bort ämne"
// turns the chips into remove buttons, and removing one takes its sets and tests with it, with Undo.
//
// Only a name comes out (getValue / onChange); the subject itself is made when the set is saved.

import { el, toast } from "../lib/dom.js";
import { store } from "../store.js";
import { t, plural } from "../lib/i18n.js";
import { isHpSetId } from "../lib/hp.js";
import { confirmDialog } from "./confirm-dialog.js";

const STANDARD = ["math", "swedish", "english", "biology", "chemistry", "physics", "history", "civics", "geography", "religion"];
const VISIBLE = 8;   // chips shown before "Visa fler"

const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const standardNames = () => STANDARD.map((k) => t(`subj.std.${k}`));

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
  const standard = standardNames().filter((n) => !own.some((o) => same(o, n)));
  return [...own, ...standard];
}

/** The subject a name stands for, when it is one the student can remove: it exists, and isn't one of
 *  the usual school subjects (those come back as suggestions anyway; their sets are deleted one by one). */
function removableSubject(name) {
  if (standardNames().some((n) => same(n, name))) return null;
  return store.subjects.find((s) => same(s.name, name)) || null;
}

export function subjectField({ value = "", onChange } = {}) {
  let choices = subjectChoices();
  let current = value.trim();
  // A name that isn't among the choices (a locked-in or typed one) opens the new-subject field with it.
  let creating = !!current && !choices.some((c) => same(c, current));
  let showAll = false;
  let managing = false;

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

  async function remove(subject) {
    const sets = store.assignments.filter((a) => a.subjectId === subject.id).length;
    const ok = await confirmDialog({
      message: sets
        ? `${t("subj.removeAsk", { name: subject.name })}\n\n${plural(sets, "subj.removeWarnOne", "subj.removeWarn")}`
        : t("subj.removeAsk", { name: subject.name }),
      confirmLabel: t("subj.removeConfirm"), danger: true,
    });
    if (!ok) return;
    const snapshot = store.removeSubject(subject.id);
    if (!snapshot) return;
    if (same(current, subject.name)) { current = ""; onChange?.(""); }
    choices = subjectChoices(); few = firstFew();
    if (!choices.some((c) => !!removableSubject(c))) managing = false;
    paint();
    toast(t("subj.removed", { name: subject.name }), {
      actionLabel: t("common.undo"),
      onAction: () => { store.restoreSubject(snapshot); choices = subjectChoices(); few = firstFew(); paint(); },
    });
  }

  function paint() {
    const shown = showAll ? choices : few;
    const chips = shown.map((name) => {
      const subject = managing ? removableSubject(name) : null;
      if (managing) {
        return el("button.subjpick__chip" + (subject ? ".subjpick__chip--remove" : ""), {
          type: "button", dataset: { name }, disabled: !subject,
          "aria-label": subject ? t("subj.removeAria", { name }) : name,
          onclick: () => remove(subject),
        }, subject ? [name, el("span.subjpick__x", { "aria-hidden": "true" }, "×")] : name);
      }
      return el("button.subjpick__chip", {
        type: "button", dataset: { name }, "aria-pressed": String(!creating && same(name, current)),
        onclick: () => pick(name),
      }, name);
    });
    const hidden = choices.length - shown.length;
    const extra = [];
    if (hidden > 0) extra.push(el("button.subjpick__more", { type: "button", onclick: () => { showAll = true; paint(); } }, t("subj.more", { n: hidden })));
    else if (showAll && choices.length > VISIBLE) extra.push(el("button.subjpick__more", { type: "button", onclick: () => { showAll = false; few = firstFew(); paint(); } }, t("subj.less")));
    const add = managing ? null : el("button.subjpick__chip.subjpick__chip--new", {
      type: "button", "aria-pressed": String(creating), "aria-expanded": String(creating),
      onclick: () => {
        creating = true; current = input.value.trim(); onChange?.(input.value); paint();
        input.focus();
      },
    }, ["+ ", t("subj.new")]);
    // Only offered while there is one of your own to remove.
    if (managing || choices.some((c) => removableSubject(c))) {
      extra.push(el("button.subjpick__more.subjpick__manage", {
        type: "button", "aria-pressed": String(managing),
        onclick: () => { managing = !managing; paint(); },
      }, managing ? t("subj.done") : t("subj.manage")));
    }
    group.replaceChildren(...chips, ...(add ? [add] : []), ...extra);
    inputWrap.hidden = !creating || managing;
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

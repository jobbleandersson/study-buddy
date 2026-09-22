// Dagens fråga, as a teacher sees it: on a class's page, write the question for
// a day (or fill it in from one of your own sets) and see how the class did.
// The teacher gets how many answered and the spread of answers — never which
// student chose what; the server doesn't send it.

import { store } from "../store.js";
import { el, icon, ICONS, toast } from "../lib/dom.js";
import { renderRich } from "../lib/rich.js";
import { t, relativeDay, fmtDate } from "../lib/i18n.js";
import { serverMessage } from "../lib/server-errors.js";
import { localDayKey, addDays } from "../lib/activity.js";
import { confirmDialog } from "./confirm-dialog.js";
import { classDailyUrl } from "../config.js";

const MAX_CHOICES = 5;
const MAX_PROMPT = 300, MAX_CHOICE = 120, MAX_EXPLANATION = 300;
const letterOf = (i) => String.fromCharCode(65 + i);

async function call(url, opts) {
  const res = await fetch(url, { credentials: "include", headers: { "content-type": "application/json" }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(serverMessage(data?.error?.message, t("login.somethingWrong")));
  return data;
}

/** Multiple-choice questions from the teacher's own sets that fit the limits. */
function pickableQuestions() {
  const out = [];
  for (const a of store.assignments) {
    for (const q of a.questions || []) {
      if (q.kind !== "mc" || !Array.isArray(q.choices) || q.choices.length < 2 || q.choices.length > MAX_CHOICES) continue;
      if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.choices.length) continue;
      if (String(q.prompt).length > MAX_PROMPT || q.choices.some((c) => String(c).length > MAX_CHOICE)) continue;
      if (q.figure || q.stimulus) continue;
      out.push({ set: a.title, q });
    }
  }
  return out.slice(0, 300);
}

/** `onChange(data)` — optional — fires with the freshly loaded `{ today, members,
 *  items }` once the list has (re)loaded, whether from the initial load, a save,
 *  or a delete. Lets a caller (see class-wizard.js's step 3, wired from
 *  classes.js) know whether the class has a daily question without fetching the
 *  same list a second time. */
export function classDailyPanel(classId, { onChange } = {}) {
  const panel = el("section.panel.dailyadmin");
  let data = null;                    // { today, members, items }
  let editing = null;                 // { id, day } of the question being rewritten, if any
  const blank = (day) => ({ day, prompt: "", choices: ["", ""], answer: 0, explanation: "" });
  let form = blank(defaultDay());
  load();
  return panel;

  function defaultDay() { return localDayKey(); }

  async function load() {
    try { data = await call(classDailyUrl(classId)); }
    catch (e) { panel.replaceChildren(el("h3", {}, t("daily.adminTitle")), el("p.note", {}, e.message || t("classes.loadFail"))); return; }
    onChange?.(data);
    // Suggest the first day from today that has no question yet.
    if (!editing) {
      let d = localDayKey();
      const taken = new Set(data.items.map((i) => i.day));
      for (let n = 0; n < 60 && taken.has(d); n++) d = addDays(d, 1);
      if (!form.prompt) form.day = d;
    }
    paint();
  }

  function paint() {
    panel.replaceChildren(
      el("h3", { style: { marginBottom: "4px" } }, t("daily.adminTitle")),
      el("p.note", { style: { marginBottom: "16px" } }, t("daily.adminNote")),
      composer(),
      data.items.length ? el("div.dailylist", {}, [
        el("h4", { style: { margin: "24px 0 8px" } }, t("daily.listTitle")),
        ...data.items.map(itemEl),
      ]) : el("p.note", { style: { marginTop: "16px" } }, t("daily.none")),
    );
  }

  /* ---------------- writing one ---------------- */
  function composer() {
    const day = el("input", { id: "daily-day", type: "date", value: form.day, min: localDayKey(), max: addDays(localDayKey(), 60),
      oninput: (e) => { form.day = e.target.value; } });
    const prompt = el("textarea.answerbox#daily-prompt", { rows: 2, maxlength: String(MAX_PROMPT), value: form.prompt,
      placeholder: t("daily.promptPlaceholder"), oninput: (e) => { form.prompt = e.target.value; } });
    const explanation = el("input", { id: "daily-why", type: "text", maxlength: String(MAX_EXPLANATION), value: form.explanation,
      placeholder: t("daily.whyPlaceholder"), oninput: (e) => { form.explanation = e.target.value; } });

    const rows = form.choices.map((c, i) => el("div.dailyform__choice", {}, [
      el("label.dailyform__correct", { title: t("daily.markCorrect") }, [
        el("input", { type: "radio", name: "daily-correct", checked: form.answer === i, "aria-label": t("daily.markCorrectN", { letter: letterOf(i) }),
          onchange: () => { form.answer = i; } }),
        el("span", {}, letterOf(i)),
      ]),
      el("input", { type: "text", maxlength: String(MAX_CHOICE), value: c, "aria-label": t("daily.optionN", { letter: letterOf(i) }),
        placeholder: t("daily.optionPlaceholder", { letter: letterOf(i) }),
        oninput: (e) => { form.choices[i] = e.target.value; } }),
      form.choices.length > 2
        ? el("button.iconbtn.iconbtn--sm", { type: "button", "aria-label": t("daily.removeOption", { letter: letterOf(i) }), title: t("daily.removeOption", { letter: letterOf(i) }),
            onclick: () => { form.choices.splice(i, 1); if (form.answer >= form.choices.length) form.answer = 0; else if (form.answer > i) form.answer--; paint(); } }, [icon(ICONS.close, 14)])
        : null,
    ].filter(Boolean)));

    const save = el("button.btn.btn--sm", { type: "button", onclick: submit }, editing ? t("daily.saveChanges") : t("daily.save"));
    const cancel = editing ? el("button.linkbtn", { type: "button", onclick: () => { editing = null; form = blank(defaultDay()); paint(); } }, t("common.cancel")) : null;

    return el("div.dailyform", {}, [
      el("label.field", {}, [el("span", {}, t("daily.day")), day]),
      el("label.field", {}, [el("span", {}, t("daily.question")), prompt]),
      el("fieldset.dailyform__choices", {}, [
        el("legend", {}, t("daily.options")),
        ...rows,
        form.choices.length < MAX_CHOICES
          ? el("button.linkbtn", { type: "button", onclick: () => { form.choices.push(""); paint(); } }, t("daily.addOption"))
          : null,
      ].filter(Boolean)),
      el("label.field", {}, [el("span", {}, t("daily.why")), explanation]),
      fromMySets(),
      el("div.dailyform__actions", {}, [save, cancel].filter(Boolean)),
    ]);
  }

  // "Fill in from one of my sets": copy a multiple-choice question over, then edit it.
  function fromMySets() {
    const options = pickableQuestions();
    if (!options.length) return null;
    const sel = el("select", { id: "daily-from", "aria-label": t("daily.fromSets") }, [
      el("option", { value: "" }, t("daily.fromSetsPick")),
      ...options.map((o, i) => el("option", { value: String(i) }, `${o.set}: ${String(o.q.prompt).replace(/\s+/g, " ").slice(0, 70)}`)),
    ]);
    sel.addEventListener("change", () => {
      const o = options[Number(sel.value)];
      if (!o) return;
      form = { ...form, prompt: String(o.q.prompt), choices: o.q.choices.map(String), answer: o.q.answer, explanation: String(o.q.explanation || "").slice(0, MAX_EXPLANATION) };
      paint();
    });
    return el("details.dailyform__from", {}, [el("summary", {}, t("daily.fromSets")), sel]);
  }

  async function submit() {
    try {
      await call(classDailyUrl(classId), { method: "PUT", body: JSON.stringify({
        day: form.day, prompt: form.prompt, choices: form.choices, answer: form.answer, explanation: form.explanation,
      }) });
      // Moving a question to another day: the old day's copy goes.
      if (editing && editing.day !== form.day) await call(`${classDailyUrl(classId)}/${editing.id}`, { method: "DELETE" });
      toast(t("daily.saved"));
      editing = null; form = blank(defaultDay());
      await load();
    } catch (e) { toast(e.message); }
  }

  /* ---------------- the list ---------------- */
  function itemEl(item) {
    const canEdit = item.answered === 0;
    return el("article.dailyitem", {}, [
      el("header.dailyitem__head", {}, [
        el("strong", {}, `${relativeDay(item.day)} · ${fmtDate(item.day)}`),
        el("span.note", {}, t("daily.answeredOf", { a: item.answered, m: item.members })),
      ]),
      el("p.dailyitem__q", { html: renderRich(item.prompt) }),
      el("ol.dailyitem__opts", {}, item.choices.map((c, i) => el("li" + (i === item.answer ? ".is-correct" : ""), {}, [
        el("span", { html: renderRich(c) }),
        i === item.answer ? el("span.sr-only", {}, ` (${t("daily.correctSr")})`) : null,
        item.spread ? el("span.dailyitem__pct", {}, `${item.spread.pct[i]} %`) : null,
      ].filter(Boolean)))),
      !item.spread && item.answered > 0 ? el("p.note", {}, t("daily.spreadHeld")) : null,
      el("div.dailyitem__actions", {}, [
        canEdit ? el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => {
          editing = { id: item.id, day: item.day };
          form = { day: item.day, prompt: item.prompt, choices: [...item.choices], answer: item.answer, explanation: item.explanation || "" };
          paint();
          panel.scrollIntoView({ block: "start" });
        } }, t("daily.edit")) : null,
        el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => remove(item) }, t("daily.delete")),
      ].filter(Boolean)),
    ]);
  }

  async function remove(item) {
    if (!(await confirmDialog({ message: t("daily.deleteConfirm"), confirmLabel: t("daily.delete"), danger: true }))) return;
    try { await call(`${classDailyUrl(classId)}/${item.id}`, { method: "DELETE" }); await load(); }
    catch (e) { toast(e.message); }
  }
}

// #/rules — "Mina regler". The one-line rules a student wrote in their own
// words after missing a question, grouped by subject. Edit or delete a rule
// (delete can be undone), print them as a review sheet for the night before a
// test, or repeat just the questions they belong to.

import { store } from "../store.js";
import { el, icon, ICONS, toast } from "../lib/dom.js";
import { t, plural, getLang, sentenceCase } from "../lib/i18n.js";
import { announce } from "../lib/a11y.js";
import { homeButton } from "../components/nav.js";
import { groupRules, hasTopic, RULE_MAX_CHARS } from "../lib/rules.js";

function fmtWritten(ms) {
  try {
    return new Intl.DateTimeFormat(getLang(), { day: "numeric", month: "short" }).format(new Date(ms));
  } catch { return ""; }
}

export function renderRules() {
  const root = el("div.rules-page");
  let editing = null;   // id of the rule being edited, if any
  paint();
  return { title: t("rules.title"), node: root };

  function paint() {
    const rules = store.rules;
    const groups = groupRules(rules, store.subjects);
    root.replaceChildren(...[
      el("div.rules-screen", {}, [
        homeButton(),
        el("h1", {}, t("rules.title")),
        rules.length
          ? el("p.note", {}, plural(rules.length, "rules.countOne", "rules.countMany"))
          : null,
        rules.length ? actions() : null,
        rules.length ? el("div.rules-groups", {}, groups.map(groupEl)) : emptyState(),
      ].filter(Boolean)),
      rules.length ? printSheet(groups) : null,
    ].filter(Boolean));
  }

  function actions() {
    return el("div.rules-actions", { "data-noprint": "" }, [
      el("a.btn.btn--sm", { href: "#/practice-rules" }, [icon(ICONS.target, 16), t("rules.repeat")]),
      el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => window.print() },
        [icon(ICONS.fileText, 16), t("rules.print")]),
    ]);
  }

  function emptyState() {
    return el("div.empty", {}, [
      icon(ICONS.pencil, 26),
      el("h2", {}, t("rules.emptyTitle")),
      el("p", {}, t("rules.emptyBody")),
      el("a.btn", { href: "#/study", style: { marginTop: "16px" } }, t("rules.emptyCta")),
    ]);
  }

  function groupEl(g) {
    const color = store.subjectColor(g.subjectId);
    return el("section.rules-group", { style: { "--subject": color.solid, "--subject-ink": color.ink, "--subject-tint": color.tint } }, [
      el("h2.rules-group__head", {}, [
        el("span.rules-group__dot", { "aria-hidden": "true" }),
        el("span", {}, g.name || t("rules.noSubject")),
        el("span.rules-group__n", {}, plural(g.rules.length, "rules.groupOne", "rules.groupMany")),
      ]),
      el("ul.rules-list", {}, g.rules.map(ruleRow)),
    ]);
  }

  function ruleRow(rule) {
    return el("li.rulerow" + (editing === rule.id ? ".rulerow--edit" : ""), {}, editing === rule.id ? editForm(rule) : [
      el("div.rulerow__main", {}, [
        el("p.rulerow__text", {}, rule.text),
        el("div.rulerow__meta", {}, [
          hasTopic(rule.topic) ? el("span.rulerow__topic", {}, sentenceCase(rule.topic)) : null,
          el("span", {}, t("rules.written", { date: fmtWritten(rule.createdAt) })),
          rule.peeks ? el("span", {}, plural(rule.peeks, "rules.peeksOne", "rules.peeksMany")) : null,
        ].filter(Boolean)),
      ]),
      el("div.rulerow__actions", { "data-noprint": "" }, [
        el("button.iconbtn", {
          type: "button", "aria-label": t("rules.edit"), title: t("rules.edit"),
          onclick: () => { editing = rule.id; paint(); root.querySelector(".rulerow__input")?.focus(); },
        }, [icon(ICONS.pencil, 16)]),
        el("button.iconbtn", {
          type: "button", "aria-label": t("rules.delete"), title: t("rules.delete"),
          onclick: () => remove(rule),
        }, [icon(ICONS.trash, 16)]),
      ]),
    ]);
  }

  function editForm(rule) {
    const input = el("input.rulerow__input", {
      type: "text", value: rule.text, maxlength: String(RULE_MAX_CHARS), autocomplete: "off",
      "aria-label": t("rules.edit"),
      onkeydown: (e) => {
        if (e.key === "Enter") { e.preventDefault(); save(); }
        if (e.key === "Escape") { e.preventDefault(); cancel(); }
      },
    });
    const save = () => {
      if (!store.updateRule(rule.id, input.value)) { input.focus(); return; }
      editing = null; paint(); announce(t("rules.updated"));
    };
    const cancel = () => { editing = null; paint(); };
    return [
      el("div.rulerow__main", {}, [input]),
      el("div.rulerow__actions", {}, [
        el("button.btn.btn--sm", { type: "button", onclick: save }, t("rules.saveEdit")),
        el("button.linkbtn", { type: "button", onclick: cancel }, t("common.cancel")),
      ]),
    ];
  }

  function remove(rule) {
    const removed = store.removeRule(rule.id);
    if (!removed) return;
    paint();
    announce(t("rules.deleted"));
    toast(t("rules.deleted"), {
      actionLabel: t("common.undo"),
      onAction: () => { store.restoreRule(removed); paint(); announce(t("rules.restored")); },
    });
  }

  // Only ever shown by `@media print` (see app.css) — a plain list with room to
  // tick each rule off, so it works as a last look before a test.
  function printSheet(groups) {
    return el("div.rulesheet", { "aria-hidden": "true" }, [
      el("h1", {}, t("rules.title")),
      el("p.rulesheet__meta", {}, [t("print.name"), " ______________________   ", t("print.date"), " __________"]),
      ...groups.map((g) => el("section.rulesheet__group", {}, [
        el("h2", {}, g.name || t("rules.noSubject")),
        el("ul", {}, g.rules.map((r) => el("li", {}, [
          el("span.rulesheet__box", {}),
          el("span", {}, [
            r.text,
            hasTopic(r.topic) ? el("small", {}, ` — ${sentenceCase(r.topic)}`) : null,
          ].filter(Boolean)),
        ]))),
      ])),
    ]);
  }
}

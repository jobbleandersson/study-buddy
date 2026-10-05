// #/rules — "Mina regler". The one-line rules a student wrote in their own
// words after missing a question, grouped by subject as cards. Search them and
// narrow to one subject, edit or delete a rule (delete can be undone), print
// them as a review sheet for the night before a test, or repeat just the
// questions they belong to. With no rules yet, the page explains how they come
// about and shows what one looks like.

import { store } from "../store.js";
import { el, icon, ICONS, toast } from "../lib/dom.js";
import { t, plural, getLang, sentenceCase } from "../lib/i18n.js";
import { announce } from "../lib/a11y.js";
import { homeButton } from "../components/nav.js";
import { groupRules, hasTopic, RULE_MAX_CHARS } from "../lib/rules.js";

// The search box and subject chips only appear once there are enough rules to need them.
const SEARCH_FROM = 6;

function fmtWritten(ms) {
  try {
    return new Intl.DateTimeFormat(getLang(), { day: "numeric", month: "short" }).format(new Date(ms));
  } catch { return ""; }
}

export function renderRules() {
  const root = el("div.rules-page");
  let editing = null;   // id of the rule being edited, if any
  let query = "";
  let subjectFilter = null;   // a subjectId, or null for every subject
  const searchInput = el("input.search__input", {
    type: "search", placeholder: t("rules.search"), "aria-label": t("rules.search"),
    oninput: (e) => { query = e.target.value.trim().toLowerCase(); paintList(); },
  });
  const listEl = el("div.rules-groups");
  let groupsCache = [];
  paint();
  return { title: t("rules.title"), node: root };

  function paint() {
    const rules = store.rules;
    groupsCache = groupRules(rules, store.subjects);
    const searchable = rules.length >= SEARCH_FROM;
    // A filter whose control isn't on screen any more (too few rules, one subject left) mustn't keep
    // hiding rules with nothing there to clear it.
    if (!searchable) { query = ""; searchInput.value = ""; }
    if (!searchable || groupsCache.length < 2 || !groupsCache.some((g) => g.subjectId === subjectFilter)) subjectFilter = null;
    root.replaceChildren(...[
      el("div.rules-screen", {}, [
        homeButton(),
        el("header.rules-head", {}, [
          el("div", {}, [
            el("h1", {}, t("rules.title")),
            rules.length ? el("p.rules-head__sub", {}, [
              plural(rules.length, "rules.countOne", "rules.countMany"), ". ", t("rules.lede"), ".",
            ]) : null,
          ].filter(Boolean)),
          rules.length ? actions() : null,
        ].filter(Boolean)),
        rules.length && searchable ? el("div.rules-tools", { "data-noprint": "" }, [
          el("div.search.rules-tools__search", {}, [icon(ICONS.search, 16), searchInput]),
          groupsCache.length > 1 ? subjectChips() : null,
        ].filter(Boolean)) : null,
        rules.length ? listEl : emptyState(),
      ].filter(Boolean)),
      rules.length ? printSheet(groupsCache) : null,
    ].filter(Boolean));
    if (rules.length) paintList();
  }

  function paintList() {
    const shown = groupsCache
      .filter((g) => !subjectFilter || g.subjectId === subjectFilter)
      .map((g) => ({ ...g, rules: g.rules.filter((r) => matches(r, g)) }))
      .filter((g) => g.rules.length);
    listEl.replaceChildren(...(shown.length
      ? shown.map(groupEl)
      : [el("p.rules-nomatch", {}, t("rules.noMatch", { q: searchInput.value.trim() }))]));
  }

  function matches(rule, group) {
    if (!query) return true;
    return [rule.text, rule.topic, group.name].filter(Boolean).join(" ").toLowerCase().includes(query);
  }

  function actions() {
    return el("div.rules-actions", { "data-noprint": "" }, [
      el("a.btn", { href: "#/practice-rules" }, [icon(ICONS.target, 16), t("rules.repeat")]),
      el("button.btn.btn--ghost", { type: "button", onclick: () => window.print() },
        [icon(ICONS.fileText, 16), t("rules.print")]),
    ]);
  }

  function subjectChips() {
    const chip = (id, label, n, color) => el("button.rules-chip", {
      type: "button", "aria-pressed": String(subjectFilter === id),
      style: color ? { "--subject": color } : null,
      onclick: () => { subjectFilter = id; paint(); },
    }, [color ? el("i", { "aria-hidden": "true" }) : null, label, el("b", {}, String(n))].filter(Boolean));
    return el("div.rules-chips", { role: "group", "aria-label": t("rules.filterSubject") }, [
      chip(null, t("rules.filterAll"), store.rules.length),
      ...groupsCache.map((g) => chip(g.subjectId, g.name || t("rules.noSubject"), g.rules.length, store.subjectColor(g.subjectId).solid)),
    ]);
  }

  /** What the page is for, before there's anything on it: how a rule comes about, and one to look at. */
  function emptyState() {
    const steps = ["rules.step1", "rules.step2", "rules.step3"];
    return el("section.rules-empty", {}, [
      el("div.rules-empty__text", {}, [
        el("h2", {}, t("rules.emptyTitle")),
        el("ol.rules-steps", {}, steps.map((key, i) => el("li", {}, [el("span.rules-steps__n", { "aria-hidden": "true" }, String(i + 1)), t(key)]))),
        el("a.btn", { href: "#/study" }, [icon(ICONS.play, 16), t("rules.emptyCta")]),
      ]),
      el("div.rules-empty__sample", { "aria-label": t("rules.example") }, [
        el("span.rules-empty__tag", {}, t("rules.example")),
        el("article.myrule", { style: { "--subject": "var(--brand)", "--subject-ink": "var(--brand-ink)", "--subject-tint": "var(--brand-tint)" } }, [
          el("span.myrule__quote", { "aria-hidden": "true" }, "“"),
          el("p.myrule__text", {}, t("rules.exampleText")),
          el("div.myrule__foot", {}, [
            el("span.myrule__topic", {}, t("rules.exampleTopic")),
            el("span", {}, t("rules.exampleSubject")),
          ]),
        ]),
      ]),
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
      el("ul.rules-list", {}, g.rules.map(ruleCard)),
    ]);
  }

  function ruleCard(rule) {
    if (editing === rule.id) return el("li.myrule.myrule--edit", {}, editForm(rule));
    return el("li.myrule", {}, [
      el("span.myrule__quote", { "aria-hidden": "true" }, "“"),
      el("p.myrule__text", {}, rule.text),
      el("div.myrule__foot", {}, [
        hasTopic(rule.topic) ? el("span.myrule__topic", {}, sentenceCase(rule.topic)) : null,
        el("span", {}, t("rules.written", { date: fmtWritten(rule.createdAt) })),
        rule.peeks ? el("span", {}, plural(rule.peeks, "rules.peeksOne", "rules.peeksMany")) : null,
        el("div.myrule__acts", { "data-noprint": "" }, [
        el("button.iconbtn.iconbtn--sm", {
          type: "button", "aria-label": t("rules.edit"), title: t("rules.edit"),
          onclick: () => { editing = rule.id; paintList(); root.querySelector(".myrule__input")?.focus(); },
        }, [icon(ICONS.pencil, 15)]),
        el("button.iconbtn.iconbtn--sm.myrule__del", {
          type: "button", "aria-label": t("rules.delete"), title: t("rules.delete"),
          onclick: () => remove(rule),
        }, [icon(ICONS.trash, 15)]),
        ]),
      ].filter(Boolean)),
    ]);
  }

  function editForm(rule) {
    const count = el("span.myrule__count", { "aria-hidden": "true" });
    const input = el("textarea.myrule__input", {
      rows: 3, maxlength: String(RULE_MAX_CHARS), autocomplete: "off", "aria-label": t("rules.edit"),
      oninput: () => sync(),
      onkeydown: (e) => {
        // One line, so Enter saves (Shift+Enter would only add a line break the rule can't keep).
        if (e.key === "Enter") { e.preventDefault(); save(); }
        if (e.key === "Escape") { e.preventDefault(); cancel(); }
      },
    });
    input.value = rule.text;
    const sync = () => { count.textContent = `${input.value.length}/${RULE_MAX_CHARS}`; };
    sync();
    const save = () => {
      if (!store.updateRule(rule.id, input.value)) { input.focus(); return; }
      editing = null; paint(); announce(t("rules.updated"));
    };
    const cancel = () => { editing = null; paintList(); };
    return [
      el("div.myrule__field", {}, [input, count]),
      el("div.myrule__editacts", {}, [
        el("button.btn.btn--sm", { type: "button", onclick: save }, t("rules.saveEdit")),
        el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: cancel }, t("common.cancel")),
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

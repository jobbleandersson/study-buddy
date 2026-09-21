// The two small pieces of "Minnesregler" that live on a question:
//  - ruleSaveCard: after a miss, one line to write the rule down in your own words
//  - rulePeek: when a question comes back, your rule for it, one tap away
// Both are optional and cost nothing — no AI, just the student's own sentence.

import { store } from "../store.js";
import { el, icon, ICONS, uid } from "../lib/dom.js";
import { t, plural } from "../lib/i18n.js";
import { announce } from "../lib/a11y.js";
import { RULE_MAX_CHARS, hasTopic } from "../lib/rules.js";

/**
 * "Hur ska du komma ihåg det?" — a single-line prompt shown under a missed
 * question. Saving swaps it for a short confirmation; skipping just removes it.
 * `context` is { subjectId, topic, questionId }.
 */
export function ruleSaveCard(context) {
  const inputId = `rule-in-${uid()}`;
  const input = el("input.rulecard__input", {
    id: inputId, type: "text", maxlength: String(RULE_MAX_CHARS), autocomplete: "off",
    enterkeyhint: "done", placeholder: t("rules.placeholder"),
    "aria-describedby": `${inputId}-hint`,
    oninput: sync,
    onkeydown: (e) => {
      if (e.key === "Enter") { e.preventDefault(); save(); }
      if (e.key === "Escape") { e.preventDefault(); card.remove(); }
      e.stopPropagation();   // typing a rule must never trigger the session's A–D / Enter shortcuts
    },
  });
  const count = el("span.rulecard__count", { "aria-hidden": "true" });
  const saveBtn = el("button.btn.btn--sm", { type: "button", disabled: true, onclick: save }, t("rules.save"));
  const skipBtn = el("button.linkbtn", { type: "button", onclick: () => card.remove() }, t("rules.skip"));

  const card = el("div.rulecard", { role: "group", "aria-labelledby": `${inputId}-q` }, [
    el("div.rulecard__q", { id: `${inputId}-q` }, [icon(ICONS.pencil, 16), t("rules.ask")]),
    el("div.rulecard__field", {}, [input, count]),
    el("p.rulecard__hint", { id: `${inputId}-hint` }, t("rules.hint")),
    el("div.rulecard__actions", {}, [saveBtn, skipBtn]),
  ]);

  function sync() {
    const n = input.value.trim().length;
    saveBtn.disabled = n === 0;
    count.textContent = input.value.length >= RULE_MAX_CHARS - 30 ? `${input.value.length}/${RULE_MAX_CHARS}` : "";
  }

  function save() {
    const saved = store.addRule({ ...context, text: input.value });
    if (!saved) {
      // Only reachable when the list is full — the empty case keeps the button off.
      if (input.value.trim()) announce(t("rules.full"));
      return;
    }
    card.classList.add("rulecard--saved");
    card.replaceChildren(
      icon(ICONS.check, 16),
      el("span", {}, [t("rules.saved"), " ", el("a", { href: "#/rules" }, t("rules.seeAll"))]),
    );
    card.removeAttribute("aria-labelledby");
    card.setAttribute("role", "status");
    announce(t("rules.saved"));
  }
  return card;
}

/**
 * "Du har en regel om Förändringsfaktor" — a collapsed line above a question
 * that has one or more rules. Opening it shows the rule(s) and calls
 * `onPeek()` once: looking is fine, but the question then comes back a little
 * sooner (the session does that). `rules` is newest-first.
 */
export function rulePeek(rules, topic, onPeek) {
  const id = `rule-peek-${uid()}`;
  const label = hasTopic(topic)
    ? plural(rules.length, "rules.peekOneTopic", "rules.peekManyTopic", { topic })
    : plural(rules.length, "rules.peekOne", "rules.peekMany");
  let peeked = false;

  const body = el("div.rulepeek__body", { id, hidden: true }, [
    el("ul.rulepeek__list", {}, rules.slice(0, 3).map((r) => el("li", {}, r.text))),
    el("p.rulepeek__note", {}, t("rules.peekNote")),
  ]);
  const btn = el("button.rulepeek__btn", {
    type: "button", "aria-expanded": "false", "aria-controls": id,
    onclick: () => {
      const open = btn.getAttribute("aria-expanded") !== "true";
      btn.setAttribute("aria-expanded", String(open));
      body.hidden = !open;
      if (open && !peeked) { peeked = true; onPeek?.(); }
    },
  }, [
    icon(ICONS.pencil, 15),
    el("span.rulepeek__label", {}, label),
    el("span.rulepeek__cta", {}, t("rules.peekShow")),
  ]);
  return el("div.rulepeek", {}, [btn, body]);
}

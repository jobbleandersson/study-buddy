// Dagens fråga, as a student sees it: one card at the top of Home with the
// question their teacher set for today. Answer once, then see how the class
// did — as a spread, never as names.

import { store } from "../store.js";
import { el, icon, ICONS, toast } from "../lib/dom.js";
import { renderRich } from "../lib/rich.js";
import { t } from "../lib/i18n.js";
import { announce } from "../lib/a11y.js";
import { serverMessage } from "../lib/server-errors.js";
import { fetchMyDaily, cachedDaily, answerDaily, rememberAnswer } from "../lib/daily.js";

const letterOf = (i) => String.fromCharCode(65 + i);

/**
 * A slot for the home page. Empty (and hidden) unless the student is signed in
 * and one of their classes has a question today; it fills itself in once the
 * server has answered, or straight away from the cache on a redraw.
 */
export function dailySlot() {
  if (!store.authed) return null;
  const slot = el("div.daily-slot", { hidden: true });
  const paint = (items) => {
    slot.replaceChildren(...items.map(dailyCard));
    slot.hidden = !items.length;
  };
  const cached = cachedDaily();
  if (cached) paint(cached);
  else fetchMyDaily().then(paint);
  return slot;
}

function dailyCard(item) {
  const card = el("section.dailycard", { "aria-label": t("daily.title") });
  draw();
  return card;

  function draw() {
    const r = item.result;
    card.replaceChildren(
      el("header.dailycard__head", {}, [
        el("span.dailycard__avatar", { "aria-hidden": "true" }, [icon(ICONS.users, 18)]),
        el("div", {}, [
          el("strong", {}, t("daily.title")),
          el("span", {}, item.className),
        ]),
      ]),
      el("div.dailycard__q", { html: renderRich(item.prompt) }),
      el("div.choices.dailycard__opts", { role: "group", "aria-label": t("bus.optionsLabel") },
        item.choices.map((c, i) => optionEl(c, i, r))),
      r ? resultEl(r) : el("p.dailycard__hint", {}, t("daily.hint")),
      streakEl(),
    );
  }

  function optionEl(text, i, r) {
    const cls = r ? (i === r.answer ? ".is-correct" : i === r.choice ? ".is-wrong" : "") : "";
    return el("button.choice" + cls, {
      type: "button", disabled: !!r, onclick: () => pick(i),
    }, [el("span.choice__key", {}, letterOf(i)), el("span", { html: renderRich(text) })]);
  }

  function resultEl(r) {
    const right = r.choice === r.answer;
    const share = r.spread ? r.spread.pct[r.answer] : null;
    return el("div.dailycard__result", {}, [
      el("p.dailycard__verdict", {}, [
        el("strong", {}, right ? t("daily.right") : t("daily.wrong", { letter: letterOf(r.answer) })),
        share != null ? ` ${t("daily.classRight", { pct: share })}` : null,
      ].filter(Boolean)),
      r.spread
        ? el("div.dailyspread", {}, item.choices.map((_, i) => spreadRow(i, r.spread.pct[i], i === r.answer)))
        : el("p.note", {}, t("daily.spreadHidden")),
      r.explanation ? el("p.dailycard__why", { html: renderRich(r.explanation) }) : null,
      el("p.dailycard__privacy", {}, t("daily.privacy")),
    ].filter(Boolean));
  }

  function spreadRow(i, pct, correct) {
    return el("div.dailyspread__row" + (correct ? ".is-correct" : ""), {}, [
      el("span.dailyspread__key", {}, letterOf(i)),
      el("span.dailyspread__bar", { role: "img", "aria-label": t("daily.spreadRow", { letter: letterOf(i), pct }) }, [el("i", { style: { width: `${pct}%` } })]),
      el("span.dailyspread__pct", {}, `${pct} %`),
    ]);
  }

  // "The class has answered 5 days in a row. 18 of 24 have answered today."
  function streakEl() {
    const p = item.participation;
    const n = Math.max(0, Math.min(Number(item.streak) || 0, 7));
    if (!p) return null;
    return el("div.dailycard__streak", {}, [
      el("span.dailydots", { "aria-hidden": "true" }, Array.from({ length: 7 }, (_, i) => el("i" + (i < n ? ".is-on" : "")))),
      el("span", {}, [
        item.streak > 0 ? t("daily.streak", { n: item.streak }) + " " : "",
        t("daily.today", { a: p.answered, m: p.members }),
      ].join("")),
    ]);
  }

  async function pick(i) {
    if (item.result) return;
    card.querySelectorAll(".choice").forEach((b) => { b.disabled = true; });
    try {
      const { result, streak, fresh } = await answerDaily(item.id, i);
      rememberAnswer(item.id, result, streak);
      item.result = result;
      item.participation = { answered: result.answered, members: result.members };
      if (streak != null) item.streak = streak;
      draw();
      announce(result.choice === result.answer ? t("daily.right") : t("daily.wrong", { letter: letterOf(result.answer) }));
      // Counts toward today's goal and the streak; may redraw Home, which reads the cache we just filled.
      if (fresh) store.recordDailyAnswer({ dailyId: item.id, title: t("daily.title"), correct: result.choice === result.answer });
    } catch (e) {
      toast(serverMessage(e.message, t("login.somethingWrong")));
      draw();
    }
  }
}

// Progress dashboard: study streak, per-subject mastery meters, due-for-review list.

import { store } from "../store.js";
import { el, icon, ICONS } from "../lib/dom.js";
import { renderRich } from "../lib/rich.js";
import { masteryByTopic, masteryForSubject } from "../lib/mastery.js";
import { dueLabel } from "../lib/srs.js";
import { localDayKey, recentDays, currentStreak } from "../lib/activity.js";

export function renderProgress() {
  const tm = masteryByTopic(store.attempts);
  const attemptsCount = store.attempts.length;
  const streak = store.streak;

  // ---- streak strip: last 14 local days ----
  const studied = new Set(store.state.activity.daysStudied);
  const today = localDayKey();
  const days = recentDays(14).map((key) => {
    const label = Number(key.slice(8, 10));
    return el("div", {
      class: "streak__day" + (studied.has(key) ? " on" : "") + (key === today ? " today" : ""),
      title: key + (studied.has(key) ? " — studied" : ""),
    }, String(label));
  });

  // ---- mastery meters ----
  const subjectMeters = store.subjects
    .map((s) => ({ s, m: masteryForSubject(s.id, store.assignments, tm) }))
    .filter((x) => x.m != null)
    .sort((a, b) => a.m - b.m)
    .map(({ s, m }) => {
      const color = store.subjectColor(s.id);
      const pct = Math.round(m * 100);
      return el("div.meter", {}, [
        el("span", {}, s.name),
        el("div.meter__track", {
          role: "img", "aria-label": `${s.name}: ${pct}% mastery`,
        }, [el("div.meter__fill", { style: { width: "0%", "--subject": color.solid }, dataset: { w: pct } })]),
        el("span.tabular", { style: { textAlign: "right", fontWeight: 700 } }, `${pct}%`),
      ]);
    });

  // ---- due for review ----
  const dueItems = store.dueQuestions();

  const node = el("div.dash", {}, [
    el("h1", {}, "Your progress"),

    el("section.panel", {}, [
      el("h3", { style: { marginBottom: "12px", display: "flex", alignItems: "center", gap: "10px" } }, [
        "Study streak",
        el("span.streakbadge", {}, [icon(ICONS.flame, 13), `${streak} day${streak === 1 ? "" : "s"}`]),
      ]),
      el("div.streak", { role: "img", "aria-label": `Studied on ${[...studied].filter((d) => recentDays(14).includes(d)).length} of the last 14 days` }, days),
      el("p.note", { style: { marginTop: "10px" } },
        `${store.state.activity.daysStudied.length} day${store.state.activity.daysStudied.length === 1 ? "" : "s"} studied · ${attemptsCount} session${attemptsCount === 1 ? "" : "s"} completed`),
    ]),

    el("section.panel", {}, [
      el("h3", { style: { marginBottom: "8px" } }, "Mastery by subject"),
      subjectMeters.length ? el("div", {}, subjectMeters)
        : el("p.note", {}, "Finish a session to start building mastery scores. Weakest topics show first."),
    ]),

    el("section.panel", {}, [
      el("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", marginBottom: "10px" } }, [
        el("h3", {}, `Due for review${dueItems.length ? ` (${dueItems.length})` : ""}`),
        dueItems.length ? el("a.btn.btn--sm", { href: "#/review" }, [icon(ICONS.spark, 16), "Review today"]) : null,
      ].filter(Boolean)),
      dueItems.length
        ? el("div", {}, [
            el("p.note", { style: { marginBottom: "10px" } },
              "“Review today” practises just these questions, pulled from every set."),
            el("div.due-list", {}, dueItems.slice(0, 12).map(({ assignment, question, rec }) =>
              el("div.due-item", {}, [
                el("span", { html: renderRich(question.prompt.length > 80 ? question.prompt.slice(0, 80) + "…" : question.prompt) }),
                el("span", { style: { display: "flex", gap: "8px", flex: "none", alignItems: "center" } }, [
                  el("span.note", {}, dueLabel(rec)),
                  el("span.badge", {}, assignment.title),
                ]),
              ]))),
            dueItems.length > 12 ? el("p.note", { style: { marginTop: "10px" } }, `+ ${dueItems.length - 12} more`) : null,
          ].filter(Boolean))
        : el("p.note", {}, "Nothing due right now. Spaced repetition brings questions back just before you'd forget them."),
    ]),

    el("a.btn.btn--ghost", { href: "#/", style: { justifySelf: "start" } }, [icon(ICONS.back, 16), "Back to menu"]),
  ]);

  requestAnimationFrame(() => {
    node.querySelectorAll(".meter__fill").forEach((f) => { f.style.width = `${f.dataset.w}%`; });
  });

  return { title: "Progress", node };
}

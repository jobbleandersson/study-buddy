// Progress dashboard: study streak, per-subject mastery meters, due-for-review list.

import { store } from "../store.js";
import { el, icon, ICONS } from "../lib/dom.js";
import { renderRich } from "../lib/rich.js";
import { masteryByTopic, masteryForSubject } from "../lib/mastery.js";
import { dueLabel } from "../lib/srs.js";
import { localDayKey, recentDays, questionsAnsweredToday } from "../lib/activity.js";
import { t, plural } from "../lib/i18n.js";
import { weakSpotQuestions } from "../lib/mastery.js";
import { goalRing } from "../components/goal-ring.js";

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

  // ---- 12-week study heatmap, week-aligned (Mon top → Sun bottom) ----
  const td = new Date();
  const mondayIdx = (td.getDay() + 6) % 7;             // Mon=0 … Sun=6
  const spanDays = mondayIdx + 11 * 7 + 1;             // back to the Monday 12 weeks ago
  const heatCells = recentDays(spanDays).map((key) =>
    el("span", {
      class: "heatmap__cell" + (studied.has(key) ? " on" : "") + (key === today ? " today" : ""),
      title: key,
    }));

  // ---- daily goal ----
  const goal = Number(store.settings.dailyGoal) || 0;
  const answeredToday = questionsAnsweredToday(store.attempts);

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
          role: "img", "aria-label": t("prog.masteryAria", { subject: s.name, pct }),
        }, [el("div.meter__fill", { style: { width: "0%", "--subject": color.solid }, dataset: { w: pct } })]),
        el("span.tabular", { style: { textAlign: "right", fontWeight: 700 } }, `${pct}%`),
      ]);
    });

  // ---- due for review ----
  const dueItems = store.dueQuestions();
  const weakCount = weakSpotQuestions(store.assignments, store.attempts).length;

  const node = el("div.dash", {}, [
    el("h1", {}, t("prog.title")),

    el("section.panel", {}, [
      el("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap", marginBottom: "12px" } }, [
        el("h3", { style: { display: "flex", alignItems: "center", gap: "10px" } }, [
          t("prog.streak"),
          el("span.streakbadge", {}, [icon(ICONS.flame, 13), plural(streak, "prog.streakDaysOne", "prog.streakDaysMany")]),
        ]),
        goal > 0 && el("span", { style: { display: "flex", alignItems: "center", gap: "8px", color: "var(--ink-soft)", fontSize: "var(--fs-sm)", fontWeight: "700" } }, [
          goalRing(answeredToday, goal),
          answeredToday >= goal ? t("menu.goalDone") : t("menu.goalToday", { done: answeredToday, goal }),
        ]),
      ].filter(Boolean)),
      el("div.streak", { role: "img", "aria-label": t("prog.streakAria", { n: [...studied].filter((d) => recentDays(14).includes(d)).length }) }, days),
      el("p.note", { style: { marginTop: "10px" } }, t("prog.summary", {
        days: plural(store.state.activity.daysStudied.length, "prog.daysOne", "prog.daysMany"),
        sessions: plural(attemptsCount, "prog.sessionsOne", "prog.sessionsMany"),
      })),
    ]),

    el("section.panel", {}, [
      el("h3", { style: { marginBottom: "6px" } }, t("prog.heatmapTitle")),
      el("p.note", { style: { marginBottom: "12px" } }, t("prog.heatmapSub")),
      el("div.heatmap", { role: "img", "aria-label": t("prog.heatmapSub") }, heatCells),
    ]),

    el("section.panel", {}, [
      el("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", marginBottom: "8px" } }, [
        el("h3", {}, t("prog.mastery")),
        // Only offered once there's enough history to know what "weak" means.
        weakCount ? el("a.btn.btn--sm", { href: "#/practice-weak" },
          [icon(ICONS.target, 16), t("prog.practiseWeak")]) : null,
      ].filter(Boolean)),
      subjectMeters.length ? el("div", {}, subjectMeters)
        : el("p.note", {}, t("prog.masteryEmpty")),
    ]),

    el("section.panel", {}, [
      el("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", marginBottom: "10px" } }, [
        el("h3", {}, dueItems.length ? t("prog.dueCount", { n: dueItems.length }) : t("prog.due")),
        dueItems.length ? el("a.btn.btn--sm", { href: "#/review" }, [icon(ICONS.spark, 16), t("prog.reviewToday")]) : null,
      ].filter(Boolean)),
      dueItems.length
        ? el("div", {}, [
            el("p.note", { style: { marginBottom: "10px" } },
              t("prog.reviewExplain")),
            el("div.due-list", {}, dueItems.slice(0, 12).map(({ assignment, question, rec }) =>
              el("div.due-item", {}, [
                el("span", { html: renderRich(question.prompt.length > 80 ? question.prompt.slice(0, 80) + "…" : question.prompt) }),
                el("span", { style: { display: "flex", gap: "8px", flex: "none", alignItems: "center" } }, [
                  el("span.note", {}, dueLabel(rec)),
                  el("span.badge", {}, assignment.title),
                ]),
              ]))),
            dueItems.length > 12 ? el("p.note", { style: { marginTop: "10px" } }, t("prog.moreDue", { n: dueItems.length - 12 })) : null,
          ].filter(Boolean))
        : el("p.note", {}, t("prog.nothingDue")),
    ]),

    el("a.btn.btn--ghost", { href: "#/", style: { justifySelf: "start" } }, [icon(ICONS.back, 16), t("common.backToMenu")]),
  ]);

  requestAnimationFrame(() => {
    node.querySelectorAll(".meter__fill").forEach((f) => { f.style.width = `${f.dataset.w}%`; });
  });

  return { title: t("common.progress"), node };
}

// Progress dashboard: study streak, per-subject mastery meters, due-for-review list.

import { store } from "../store.js";
import { el, icon, ICONS } from "../lib/dom.js";
import { renderRich } from "../lib/rich.js";
import { masteryByTopic, masteryForSubject } from "../lib/mastery.js";
import { dueLabel, reviewReason } from "../lib/srs.js";
import { localDayKey, recentDays, questionsAnsweredToday, reviewAccuracyTrend } from "../lib/activity.js";
import { t, plural } from "../lib/i18n.js";
import { weakSpotQuestions } from "../lib/mastery.js";
import { goalRing } from "../components/goal-ring.js";
import { homeButton } from "../components/nav.js";
import { achievementRows, titleKey, descKey } from "../lib/achievements.js";

export function renderProgress() {
  const tm = masteryByTopic(store.attempts);
  const attemptsCount = store.attempts.length;
  const { streak, freezes, atRisk, displayStreak, bestStreak, nextFreezeIn } = store.streakInfo;

  // ---- streak strip: last 14 local days ----
  const studied = new Set(store.state.activity.daysStudied);
  const frozen = new Set(store.state.activity.frozenDays);
  const today = localDayKey();
  const dayCell = (key, cls) => {
    const on = studied.has(key), fz = frozen.has(key);
    // "is-today", not "today": a bare .today rule (the menu strip) would
    // otherwise turn this into a 210px grid column and shove the number out.
    return el("div", {
      class: cls + (fz ? " frozen" : on ? " on" : "") + (key === today ? " is-today" : ""),
      title: key + (fz ? ` — ${t("streak.frozenDay")}` : on ? " — studied" : ""),
    }, cls === "streak__day" ? [String(Number(key.slice(8, 10)))] : []);
  };
  const days = recentDays(14).map((key) => dayCell(key, "streak__day"));

  // ---- 12-week study heatmap, week-aligned (Mon top → Sun bottom) ----
  const td = new Date();
  const mondayIdx = (td.getDay() + 6) % 7;             // Mon=0 … Sun=6
  const spanDays = mondayIdx + 11 * 7 + 1;             // back to the Monday 12 weeks ago
  const heatCells = recentDays(spanDays).map((key) => dayCell(key, "heatmap__cell"));

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
      const meter = el("div.meter", {}, [
        el("span", {}, s.name),
        el("div.meter__track", {
          role: "img", "aria-label": t("prog.masteryAria", { subject: s.name, pct }),
        }, [el("div.meter__fill", { style: { width: "0%", "--subject": color.solid }, dataset: { w: pct } })]),
        el("span.tabular", { style: { textAlign: "right", fontWeight: 700 } }, `${pct}%`),
      ]);
      // A near-mastered subject earns a victory lap: explain it back.
      if (m >= 0.8) {
        return el("div", { style: { padding: "2px 0" } }, [
          meter,
          el("a.linkbtn", { href: `#/teachback/${s.id}`, style: { fontSize: "var(--fs-sm)" } },
            [icon(ICONS.spark, 13), " ", t("teach.tile")]),
        ]);
      }
      return meter;
    });

  // ---- due for review ----
  const dueItems = store.dueQuestions();
  const weakCount = weakSpotQuestions(store.assignments, store.attempts).length;
  const recall = reviewAccuracyTrend(store.attempts);

  const node = el("div.dash", {}, [
    homeButton({ grid: true }),
    el("h1", {}, t("prog.title")),

    el("section.panel", {}, [
      el("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap", marginBottom: "12px" } }, [
        el("h3", { style: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" } }, [
          t("prog.streak"),
          el("span.streakbadge" + (atRisk ? ".streakbadge--risk" : ""), {}, [
            icon(atRisk ? ICONS.shield : ICONS.flame, 13),
            plural(displayStreak, "prog.streakDaysOne", "prog.streakDaysMany"),
          ]),
          freezes > 0 && el("span.freezechip", { title: t("streak.freezeHelp") }, [icon(ICONS.shield, 13), `×${freezes}`]),
        ].filter(Boolean)),
        goal > 0 && el("span", { style: { display: "flex", alignItems: "center", gap: "8px", color: "var(--ink-soft)", fontSize: "var(--fs-sm)", fontWeight: "700" } }, [
          goalRing(answeredToday, goal),
          answeredToday >= goal ? t("menu.goalDone") : t("menu.goalToday", { done: answeredToday, goal }),
        ]),
      ].filter(Boolean)),
      atRisk && el("p.note.note--warn", { style: { marginBottom: "10px" } }, t("streak.atRisk", { n: displayStreak })),
      el("div.streak", { role: "img", "aria-label": t("prog.streakAria", { n: [...studied].filter((d) => recentDays(14).includes(d)).length }) }, days),
      el("p.note", { style: { marginTop: "10px" } }, [
        t("prog.summary", {
          days: plural(store.state.activity.daysStudied.length, "prog.daysOne", "prog.daysMany"),
          sessions: plural(attemptsCount, "prog.sessionsOne", "prog.sessionsMany"),
        }),
        bestStreak > displayStreak ? " · " + t("prog.personalBest", { n: bestStreak }) : "",
        freezes === 0 && displayStreak > 0 && nextFreezeIn > 0
          ? " · " + t("streak.freezeNext", { n: nextFreezeIn }) : "",
      ]),
    ]),

    el("section.panel", {}, [
      el("h3", { style: { marginBottom: "6px" } }, t("prog.heatmapTitle")),
      el("p.note", { style: { marginBottom: "12px" } }, t("prog.heatmapSub")),
      el("div.heatmap", { role: "img", "aria-label": t("prog.heatmapSub") }, heatCells),
    ]),

    (() => {
      const rows = achievementRows(store.state);
      const got = rows.filter((r) => r.unlocked).length;
      return el("section.panel", {}, [
        el("h3", { style: { marginBottom: "4px" } }, t("prog.achievements")),
        el("p.note", { style: { marginBottom: "12px" } }, t("prog.achCount", { have: got, need: rows.length })),
        el("div.badges", {}, rows.map(({ def, unlocked, have, need }) =>
          el("div.badge-card" + (unlocked ? "" : ".is-locked"), {}, [
            el("span.badge-card__emoji", {}, def.emoji),
            el("span.badge-card__text", {}, [
              el("strong", {}, t(titleKey(def))),
              el("span.note", {}, unlocked ? t(descKey(def)) : t("prog.achProgress", { have, need })),
            ]),
          ]))),
      ]);
    })(),

    el("section.panel", {}, [
      el("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", marginBottom: "8px" } }, [
        el("h3", {}, t("prog.mastery")),
        el("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } }, [
          subjectMeters.length ? el("a.btn.btn--ghost.btn--sm", { href: "#/exam-prep" },
            [icon(ICONS.graduation, 16), t("nav.examPrep")]) : null,
          // Only offered once there's enough history to know what "weak" means.
          weakCount ? el("a.btn.btn--sm", { href: "#/practice-weak" },
            [icon(ICONS.target, 16), t("prog.practiseWeak")]) : null,
        ].filter(Boolean)),
      ].filter(Boolean)),
      subjectMeters.length ? el("div", {}, subjectMeters)
        : el("p.note", {}, t("prog.masteryEmpty")),
    ]),

    // "Is my recall actually improving?" — score on the last few cross-set
    // review sessions. Needs a few before a line means anything.
    recall.length >= 3 ? el("section.panel", {}, [
      el("h3", { style: { marginBottom: "6px" } }, t("prog.recallTitle")),
      el("p.note", { style: { marginBottom: "12px" } }, t("prog.recallSub", { n: recall.length })),
      sparkline(recall),
    ]) : null,

    el("section.panel", {}, [
      el("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", marginBottom: "10px" } }, [
        el("h3", {}, dueItems.length ? t("prog.dueCount", { n: dueItems.length }) : t("prog.due")),
        dueItems.length ? el("a.btn.btn--sm", { href: "#/review" }, [icon(ICONS.spark, 16), t("prog.reviewToday")]) : null,
      ].filter(Boolean)),
      dueItems.length
        ? el("div", {}, [
            el("p.note", { style: { marginBottom: "10px" } },
              t("prog.reviewExplain")),
            el("div.due-list", {}, dueItems.slice(0, 12).map(({ assignment, question, rec }) => {
              const why = reviewReason(rec);
              return el("div.due-item", {}, [
                el("div.due-item__main", {}, [
                  el("span", { html: renderRich(question.prompt.length > 80 ? question.prompt.slice(0, 80) + "…" : question.prompt) }),
                  why ? el("span.due-item__why", {}, why) : null,
                ].filter(Boolean)),
                el("span", { style: { display: "flex", gap: "8px", flex: "none", alignItems: "center" } }, [
                  el("span.note", {}, dueLabel(rec)),
                  el("span.badge", {}, assignment.title),
                ]),
              ]);
            })),
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

/** A bare line chart of review-session scores, built like the results-screen
 *  ring — SVG via innerHTML, no library. viewBox is wide so it scales up
 *  uniformly to the panel width; y maps 0%→bottom, 100%→top. */
function sparkline(pts) {
  const w = 600, h = 60, pad = 6;
  const x = (i) => pad + (i * (w - 2 * pad)) / Math.max(1, pts.length - 1);
  const y = (p) => h - pad - (p / 100) * (h - 2 * pad);
  const poly = pts.map((d, i) => `${x(i).toFixed(1)},${y(d.pct).toFixed(1)}`).join(" ");
  const wrap = el("div", {
    role: "img",
    "aria-label": t("prog.recallAria", { list: pts.map((d) => `${d.pct}%`).join(", ") }),
  });
  wrap.innerHTML =
    `<svg class="sparkline" viewBox="0 0 ${w} ${h}">` +
    `<polyline points="${poly}"/>` +
    pts.map((d, i) => {
      const last = i === pts.length - 1;
      return `<circle cx="${x(i).toFixed(1)}" cy="${y(d.pct).toFixed(1)}" r="${last ? 5 : 3.5}"${last ? ' class="last"' : ""}/>`;
    }).join("") +
    `</svg>`;
  return wrap;
}

// Progress dashboard: study streak, per-subject mastery meters, due-for-review list.

import { store } from "../store.js";
import { el, icon, ICONS } from "../lib/dom.js";
import { renderRich } from "../lib/rich.js";
import { masteryByTopic, masteryForSubject } from "../lib/mastery.js";
import { isDue, dueLabel } from "../lib/srs.js";

export function renderProgress() {
  const tm = masteryByTopic(store.attempts);
  const attemptsCount = store.attempts.length;

  // ---- streak strip: last 14 days ----
  const studied = new Set(store.state.activity.daysStudied);
  const today = new Date().toISOString().slice(0, 10);
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    days.push(el("div", {
      class: "streak__day" + (studied.has(key) ? " on" : "") + (key === today ? " today" : ""),
      title: key,
    }, String(d.getDate())));
  }

  // ---- mastery meters ----
  const subjectMeters = store.subjects
    .map((s) => ({ s, m: masteryForSubject(s.id, store.assignments, tm) }))
    .filter((x) => x.m != null)
    .sort((a, b) => a.m - b.m)
    .map(({ s, m }) => {
      const color = store.subjectColor(s.id);
      return el("div.meter", {}, [
        el("span", {}, s.name),
        el("div.meter__track", {}, [el("div.meter__fill", { style: { width: "0%", "--subject": color.solid }, dataset: { w: Math.round(m * 100) } })]),
        el("span.tabular", { style: { textAlign: "right", fontWeight: 700 } }, `${Math.round(m * 100)}%`),
      ]);
    });

  // ---- due for review ----
  const dueItems = [];
  for (const a of store.assignments) {
    for (const q of a.questions) {
      const rec = store.state.srs[q.id];
      if (rec && isDue(rec)) dueItems.push({ a, q, rec });
    }
  }
  dueItems.sort((x, y) => (x.rec?.dueAt || 0) - (y.rec?.dueAt || 0));

  const node = el("div.dash", {}, [
    el("h1", {}, "Your progress"),

    el("section.panel", {}, [
      el("h3", { style: { marginBottom: "12px" } }, [
        "Study streak ",
        el("span.chip", { style: { "--subject": "var(--retry)" }, "aria-pressed": "true" }, [icon(ICONS.flame, 13), `${store.state.activity.streakCount || 0} day${(store.state.activity.streakCount || 0) === 1 ? "" : "s"}`]),
      ]),
      el("div.streak", {}, days),
      el("p.note", { style: { marginTop: "10px" } }, `${store.state.activity.daysStudied.length} day(s) studied · ${attemptsCount} session(s) completed`),
    ]),

    el("section.panel", {}, [
      el("h3", { style: { marginBottom: "8px" } }, "Mastery by subject"),
      subjectMeters.length ? el("div", {}, subjectMeters)
        : el("p.note", {}, "Finish a session to start building mastery scores. Weakest topics show first."),
    ]),

    el("section.panel", {}, [
      el("h3", { style: { marginBottom: "8px" } }, `Due for review${dueItems.length ? ` (${dueItems.length})` : ""}`),
      dueItems.length ? el("div.due-list", {}, dueItems.slice(0, 12).map(({ a, q }) =>
        el("a.due-item", { href: `#/session/${a.id}` }, [
          el("span", { html: renderRich(q.prompt.length > 80 ? q.prompt.slice(0, 80) + "…" : q.prompt) }),
          el("span.badge", {}, a.title),
        ])))
        : el("p.note", {}, "Nothing due right now. Spaced-repetition brings questions back just before you'd forget them."),
    ]),

    el("a.btn.btn--ghost", { href: "#/", style: { justifySelf: "start" } }, [icon(ICONS.back, 16), "Back to menu"]),
  ]);

  requestAnimationFrame(() => {
    node.querySelectorAll(".meter__fill").forEach((f) => { f.style.width = `${f.dataset.w}%`; });
  });

  return { title: "Progress", node };
}

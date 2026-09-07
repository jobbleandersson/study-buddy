// The calendar page (#/calendar): a full month planner with the deadlines
// drawn in place as subject-coloured chips, and an agenda rail beside it
// grouping what's coming by "overdue / this week / next week / later".
//
// Distinct from the home rail's collapsed week strip and the "Kommande"
// dialog — this is the one place that's meant to be a page you plan from.

import { store } from "../store.js";
import { el, clear, icon, ICONS } from "../lib/dom.js";
import { t, fmtDate, relativeDay, daysUntil } from "../lib/i18n.js";
import { localDayKey, addDays } from "../lib/activity.js";
import { buildMonthCells, weekdayHeaders, monthLabel } from "../components/calendar.js";
import { homeButton } from "../components/nav.js";
import { openQuickAdd, closeQuickAdd } from "../components/quick-add.js";

const MAX_CHIPS = 3;

export function renderCalendarPage() {
  const items = store.upcomingDue();               // every set with a dueAt, soonest first
  const today = localDayKey();
  const now = new Date();

  // dueAt -> [assignment, …]
  const byDay = new Map();
  for (const a of items) {
    if (!byDay.has(a.dueAt)) byDay.set(a.dueAt, []);
    byDay.get(a.dueAt).push(a);
  }

  /* ---------------- the day chooser (a day with 2+ deadlines) ------------- */

  let chooserEl = null;
  const closeChooser = () => {
    chooserEl?.remove();
    chooserEl = null;
    document.removeEventListener("click", onChooserDoc, true);
    document.removeEventListener("keydown", onChooserEsc);
  };
  const onChooserDoc = (e) => { if (chooserEl && !chooserEl.contains(e.target)) closeChooser(); };
  const onChooserEsc = (e) => { if (e.key === "Escape") closeChooser(); };

  function openDayChooser(anchor, dayItems) {
    closeChooser();
    chooserEl = el("div.cardmenu.daymenu", { role: "menu" }, dayItems.map((a) => {
      const color = store.subjectColor(a.subjectId);
      return el("a.cardmenu__item", {
        href: `#/session/${a.id}`, role: "menuitem", onclick: closeChooser,
      }, [
        el("span.daymenu__dot", { style: { background: color.solid } }),
        el("span", {}, a.title),
      ]);
    }));
    const r = anchor.getBoundingClientRect();
    chooserEl.style.top = `${r.bottom + window.scrollY + 4}px`;
    chooserEl.style.left = `${Math.max(8, Math.min(r.left + window.scrollX, window.innerWidth - 220))}px`;
    document.body.appendChild(chooserEl);
    chooserEl.querySelector("a")?.focus();
    setTimeout(() => {
      document.addEventListener("click", onChooserDoc, true);
      document.addEventListener("keydown", onChooserEsc);
    }, 0);
  }

  /* ---------------- the month grid ---------------- */

  let viewY = now.getFullYear();
  let viewM = now.getMonth();

  const monthLbl = el("span.plan-cal__month");
  const gridWrap = el("div.plan-cal__body");
  const todayBtn = el("button.btn.btn--ghost.btn--sm.plan-cal__today", {
    type: "button",
    onclick: () => { viewY = now.getFullYear(); viewM = now.getMonth(); paintCal(); },
  }, t("cal.today"));

  const shiftMonth = (d) => {
    const nd = new Date(viewY, viewM + d, 1);
    viewY = nd.getFullYear(); viewM = nd.getMonth();
    paintCal();
  };

  const calHead = el("div.plan-cal__head", {}, [
    el("div.plan-nav", {}, [
      el("button.plan-nav__btn", { type: "button", "aria-label": t("cal.prevMonth"), onclick: () => shiftMonth(-1) }, "‹"),
      el("button.plan-nav__btn", { type: "button", "aria-label": t("cal.nextMonth"), onclick: () => shiftMonth(1) }, "›"),
    ]),
    monthLbl,
    todayBtn,
  ]);

  function dayCell({ key, inMonth, date }) {
    const dayItems = byDay.get(key) || [];
    const cls = ["div.plan-cal__cell"];
    if (!inMonth) cls.push("is-outside");
    if (key < today) cls.push("is-past");
    if (key === today) cls.push("is-today");
    if (dayItems.length) cls.push("has-items");

    const node = el(cls.join("."), {}, [
      el("span.plan-cal__date", {}, String(date.getDate())),
    ]);

    for (const a of dayItems.slice(0, MAX_CHIPS)) {
      const color = store.subjectColor(a.subjectId);
      node.appendChild(el("a.plan-cal__chip" + (a.type === "test" ? ".is-test" : ""), {
        href: `#/session/${a.id}`,
        title: `${a.title}${a.type === "test" ? " · " + t("common.test") : ""}`,
        style: { "--subject": color.solid, "--subject-ink": color.ink, "--subject-tint": color.tint },
      }, [
        el("span.plan-cal__chip-dot"),
        el("span.plan-cal__chip-t", {}, a.title),
      ]));
    }

    if (dayItems.length > MAX_CHIPS) {
      node.appendChild(el("button.plan-cal__more", {
        type: "button",
        onclick: (e) => { e.stopPropagation(); openDayChooser(e.currentTarget, dayItems); },
      }, t("cal.more", { n: dayItems.length - MAX_CHIPS })));
    }

    // Today and future days take a new deadline; the "+" fills whatever space
    // the chips leave, so the click target is the whole empty part of the cell.
    if (key >= today) {
      node.appendChild(el("button.plan-cal__add", {
        type: "button",
        "aria-label": t("cal.addOn", { date: fmtDate(key) }),
        title: t("cal.addOn", { date: fmtDate(key) }),
        onclick: () => openQuickAdd(key),
      }, [icon(ICONS.plus, 14)]));
    }

    return node;
  }

  function paintCal() {
    monthLbl.textContent = monthLabel(viewY, viewM);
    todayBtn.hidden = viewY === now.getFullYear() && viewM === now.getMonth();
    clear(gridWrap);
    gridWrap.appendChild(el("div.plan-cal__wd", {}, weekdayHeaders().map((w) => el("span", {}, w))));
    // buildMonthCells always returns 6 weeks; drop a final week that's entirely
    // spillover from the next month so short months don't leave a dead row.
    let cells = buildMonthCells(viewY, viewM);
    if (cells.slice(35).every((c) => !c.inMonth)) cells = cells.slice(0, 35);
    const grid = el("div.plan-cal__grid");
    for (const cell of cells) grid.appendChild(dayCell(cell));
    gridWrap.appendChild(grid);
  }
  paintCal();

  const calCard = el("section.plan-cal", {}, [calHead, gridWrap]);

  /* ---------------- the agenda rail ---------------- */

  // Week boundaries, Monday-first: this week ends the coming Sunday.
  const mondayIdx = (now.getDay() + 6) % 7;
  const weekEnd = addDays(today, 6 - mondayIdx);
  const nextWeekEnd = addDays(weekEnd, 7);

  const groups = [
    { key: "overdue", label: t("cal.agendaOverdue"), cls: "is-overdue", rows: [] },
    { key: "thisWeek", label: t("cal.agendaThisWeek"), cls: "", rows: [] },
    { key: "nextWeek", label: t("cal.agendaNextWeek"), cls: "", rows: [] },
    { key: "later", label: t("cal.agendaLater"), cls: "", rows: [] },
  ];
  for (const a of items) {
    const g = a.dueAt < today ? groups[0]
      : a.dueAt <= weekEnd ? groups[1]
      : a.dueAt <= nextWeekEnd ? groups[2]
      : groups[3];
    g.rows.push(a);
  }

  function agendaRow(a) {
    const color = store.subjectColor(a.subjectId);
    const left = daysUntil(a.dueAt);
    const urgent = left < 0 ? "is-overdue" : left <= 2 ? "is-soon" : "";
    return el("a.plan-row" + (urgent ? "." + urgent : ""), {
      href: `#/session/${a.id}`,
      style: { "--subject": color.solid },
      "aria-label": t("menu.upcomingStudyAria", { title: a.title }),
    }, [
      el("span.plan-row__body", {}, [
        el("span.plan-row__title", {}, a.title),
        el("span.plan-row__meta", {}, [
          a.type === "test" ? el("span.plan-row__type", {}, t("common.test")) : null,
          el("span", {}, `${fmtDate(a.dueAt)} · ${relativeDay(a.dueAt)}`),
        ].filter(Boolean)),
      ]),
      el("span.plan-row__go", {}, icon(ICONS.play, 14)),
    ]);
  }

  const agendaInner = items.length
    ? groups.filter((g) => g.rows.length).map((g) =>
        el("div.plan-agenda__group" + (g.cls ? "." + g.cls : ""), {}, [
          el("p.plan-agenda__gtitle", {}, [
            el("span", {}, g.label),
            el("span.plan-agenda__count", {}, String(g.rows.length)),
          ]),
          el("div.plan-agenda__rows", {}, g.rows.map(agendaRow)),
        ]))
    : [
        el("div.plan-agenda__empty", {}, [
          icon(ICONS.calendar, 26),
          el("p.plan-agenda__empty-t", {}, t("cal.empty")),
          el("p.note", {}, t("cal.emptyHint")),
        ]),
      ];

  const agenda = el("aside.plan-agenda", {}, [
    el("h2.plan-agenda__head", {}, t("menu.upcoming")),
    ...agendaInner,
  ]);

  /* ---------------- page ---------------- */

  const node = el("div.planner-page", {}, [
    homeButton(),
    el("div.planner-page__head", {}, [
      el("h1", {}, t("menu.calendarTitle")),
      el("button.btn.btn--sm", {
        type: "button",
        onclick: () => openQuickAdd(today),
      }, [icon(ICONS.plus, 16), t("quickadd.newDeadline")]),
    ]),
    el("p.note.planner-page__sub", {}, t("menu.calendarSub")),
    el("div.planner", {}, [calCard, agenda]),
  ]);

  return {
    title: t("menu.calendarTitle"),
    node,
    cleanup: () => { closeChooser(); closeQuickAdd(); },
  };
}

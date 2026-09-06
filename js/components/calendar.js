// A dependency-free month calendar, in two shapes:
//   - datePicker()    — pick one day (deadline dialog, Create, Edit)
//   - monthCalendar()  — a read-only month with dots on marked days (home rail)
//
// Both are Monday-first and take their month/weekday names from the active
// locale via Intl. Day keys are the same "YYYY-MM-DD" strings the rest of the
// app uses (see js/lib/activity.js).

import { el, clear } from "../lib/dom.js";
import { t, getLang } from "../lib/i18n.js";
import { localDayKey, addDays } from "../lib/activity.js";

function locale() { return getLang() === "sv" ? "sv-SE" : "en-GB"; }

function parseKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function keyOf(date) { return localDayKey(date); }

/** Monday-first weekday index: Mon=0 … Sun=6. */
function mondayIndex(date) { return (date.getDay() + 6) % 7; }

/** The 6×7 grid of day keys covering `month` (0-indexed), padded with the
 *  trailing days of the previous month and leading days of the next. */
export function buildMonthCells(year, month) {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - mondayIndex(first));
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    cells.push({ key: keyOf(d), inMonth: d.getMonth() === month, date: d });
  }
  return cells;
}

function weekdayHeaders() {
  // 2024-01-01 is a Monday.
  const fmt = new Intl.DateTimeFormat(locale(), { weekday: "short" });
  return Array.from({ length: 7 }, (_, i) =>
    fmt.format(new Date(2024, 0, 1 + i)).replace(/\.$/, ""));
}

function monthLabel(year, month) {
  return new Intl.DateTimeFormat(locale(), { month: "long", year: "numeric" })
    .format(new Date(year, month, 1));
}

function dayLabel(key) {
  return new Intl.DateTimeFormat(locale(), { weekday: "long", day: "numeric", month: "long" })
    .format(parseKey(key));
}

/** Offset in days from today to the coming Monday (always 1–7, never 0). */
function daysToNextMonday() {
  const wd = mondayIndex(new Date());
  return wd === 0 ? 7 : 7 - wd;
}

function navHeader(label, onPrev, onNext, prevKey = "cal.prevMonth", nextKey = "cal.nextMonth") {
  return el("div.cal__nav", {}, [
    el("button.cal__navbtn", {
      type: "button", "aria-label": t(prevKey), onclick: onPrev,
    }, "‹"),
    el("span.cal__month", {}, label),
    el("button.cal__navbtn", {
      type: "button", "aria-label": t(nextKey), onclick: onNext,
    }, "›"),
  ]);
}

function weekdayRow() {
  return el("div.cal__week", {}, weekdayHeaders().map((w) =>
    el("span.cal__wd", {}, w)));
}

/* ------------------------------------------------------------------ */
/*  datePicker — pick a single day                                     */
/* ------------------------------------------------------------------ */

export function datePicker({ value = "", min = "", max = "", onChange } = {}) {
  const today = localDayKey();
  let selected = value || "";
  const anchor = selected ? parseKey(selected) : new Date();
  let viewY = anchor.getFullYear();
  let viewM = anchor.getMonth();
  let focusKey = selected || clamp(today);

  function clamp(key) {
    if (min && key < min) return min;
    if (max && key > max) return max;
    return key;
  }
  function disabled(key) { return (min && key < min) || (max && key > max); }

  const head = el("div");
  const grid = el("div.cal__grid", { role: "grid" });
  const chips = el("div.datepick__chips", {},
    [
      ["datepick.tomorrow", 1],
      ["datepick.in3days", 3],
      ["datepick.nextMon", daysToNextMonday()],
      ["datepick.in1week", 7],
      ["datepick.in2weeks", 14],
    ].map(([key, offset]) =>
      el("button.datepick__chip", {
        type: "button",
        onclick: () => select(addDays(today, offset)),
      }, t(key))));

  const root = el("div.datepick", {}, [chips, head, weekdayRow(), grid]);

  function shiftMonth(delta) {
    const d = new Date(viewY, viewM + delta, 1);
    viewY = d.getFullYear(); viewM = d.getMonth();
    paint();
  }

  function select(key, { silent = false } = {}) {
    if (disabled(key)) return;
    selected = key;
    focusKey = key;
    const d = parseKey(key);
    if (d.getFullYear() !== viewY || d.getMonth() !== viewM) {
      viewY = d.getFullYear(); viewM = d.getMonth();
    }
    paint();
    if (!silent) onChange?.(key);
  }

  function moveFocus(deltaDays) {
    const next = clamp(addDays(focusKey, deltaDays));
    focusKey = next;
    const d = parseKey(next);
    if (d.getFullYear() !== viewY || d.getMonth() !== viewM) {
      viewY = d.getFullYear(); viewM = d.getMonth();
    }
    paint();
    grid.querySelector('[tabindex="0"]')?.focus();
  }

  grid.addEventListener("keydown", (e) => {
    const map = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, PageUp: null, PageDown: null };
    if (e.key in map) {
      e.preventDefault();
      if (e.key === "PageUp") shiftMonth(-1);
      else if (e.key === "PageDown") shiftMonth(1);
      else moveFocus(map[e.key]);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      select(focusKey);
    }
  });

  function paint() {
    clear(head); head.appendChild(navHeader(monthLabel(viewY, viewM),
      () => shiftMonth(-1), () => shiftMonth(1)));

    clear(grid);
    for (const cell of buildMonthCells(viewY, viewM)) {
      const isSel = cell.key === selected;
      const isFocus = cell.key === focusKey;
      const off = disabled(cell.key);
      grid.appendChild(el("button.cal__cell", {
        type: "button",
        tabindex: isFocus ? "0" : "-1",
        disabled: off,
        "aria-selected": String(isSel),
        class: [
          !cell.inMonth && "is-outside",
          cell.key === today && "is-today",
          isSel && "is-selected",
        ].filter(Boolean).join(" "),
        onclick: () => select(cell.key),
      }, String(cell.date.getDate())));
    }
  }
  paint();

  return {
    el: root,
    getValue: () => selected,
    setValue: (key) => select(key || "", { silent: true }),
  };
}

/* ------------------------------------------------------------------ */
/*  monthCalendar — read-only, dots on marked days                     */
/* ------------------------------------------------------------------ */

/** `onView(start, end)` fires on every paint — initial and after paging —
 *  with the day-key range of the actual displayed month (not the grid's
 *  dimmed lead/trail days from neighbouring months), so a caller can filter
 *  its own list to match. */
export function monthCalendar({ marks = new Map(), onPick, onView, onAdd } = {}) {
  const today = localDayKey();
  const now = new Date();
  let viewY = now.getFullYear();
  let viewM = now.getMonth();

  const head = el("div");
  const grid = el("div.cal__grid");
  const root = el("div.cal.cal--mini", {}, [head, weekdayRow(), grid]);

  function shiftMonth(delta) {
    const d = new Date(viewY, viewM + delta, 1);
    viewY = d.getFullYear(); viewM = d.getMonth();
    paint();
  }

  function paint() {
    clear(head); head.appendChild(navHeader(monthLabel(viewY, viewM),
      () => shiftMonth(-1), () => shiftMonth(1)));

    clear(grid);
    for (const cell of buildMonthCells(viewY, viewM)) {
      const mark = marks.get(cell.key);
      const canAdd = !mark && onAdd && cell.inMonth && cell.key >= today;
      const interactive = mark || canAdd;
      const node = el(interactive ? "button.cal__cell" : "span.cal__cell", {
        type: interactive ? "button" : undefined,
        title: mark ? mark.titles.join(", ") : canAdd ? t("cal.addOn", { date: dayLabel(cell.key) }) : undefined,
        "aria-label": canAdd ? t("cal.addOn", { date: dayLabel(cell.key) }) : undefined,
        class: [
          !cell.inMonth && "is-outside",
          cell.key === today && "is-today",
          mark && "is-marked",
          canAdd && "is-addable",
        ].filter(Boolean).join(" "),
        onclick: mark && onPick ? (e) => onPick(cell.key, mark, e.currentTarget)
          : canAdd ? (e) => onAdd(cell.key, e.currentTarget) : undefined,
      }, [
        String(cell.date.getDate()),
        mark && el("span.cal__dot" + (mark.ids.length > 1 ? ".cal__dot--multi" : "")),
        canAdd && el("span.cal__add", { "aria-hidden": "true" }, "+"),
      ]);
      grid.appendChild(node);
    }
    // The actual month, not the grid's dimmed lead/trail days from neighbours.
    onView?.(keyOf(new Date(viewY, viewM, 1)), keyOf(new Date(viewY, viewM + 1, 0)));
  }
  paint();

  return { el: root };
}

/* ------------------------------------------------------------------ */
/*  weekStrip — the collapsed form of monthCalendar: just this week    */
/* ------------------------------------------------------------------ */

/** A single Monday-first week, dots on marked days, with the same ‹ › nav
 *  as monthCalendar so a visitor can page to last/next week. Starts on the
 *  current week. The compact form of monthCalendar() for tight spaces (the
 *  home rail, collapsed) — no weekday-letter header, to keep it light; the
 *  Upcoming list right below already spells out each day. `onView(start, end)`
 *  fires on every paint — initial and after paging — with the day keys of
 *  the visible week, so the caller can filter its own list/empty-state to
 *  match whichever week is currently in view. */
export function weekStrip({ marks = new Map(), onPick, onView, onAdd } = {}) {
  const today = localDayKey();
  let weekStart = addDays(keyOf(new Date()), -mondayIndex(new Date()));

  const head = el("div");
  const grid = el("div.cal__grid");
  const root = el("div.cal.cal--mini.cal--week", {}, [head, grid]);

  function shiftWeek(delta) {
    weekStart = addDays(weekStart, delta * 7);
    paint();
  }

  function rangeLabel() {
    const fmt = new Intl.DateTimeFormat(locale(), { day: "numeric", month: "short" });
    return `${fmt.format(parseKey(weekStart))} – ${fmt.format(parseKey(addDays(weekStart, 6)))}`;
  }

  function paint() {
    clear(head);
    head.appendChild(navHeader(rangeLabel(), () => shiftWeek(-1), () => shiftWeek(1), "cal.prevWeek", "cal.nextWeek"));

    clear(grid);
    for (let i = 0; i < 7; i++) {
      const key = addDays(weekStart, i);
      const date = parseKey(key);
      const mark = marks.get(key);
      const canAdd = !mark && onAdd && key >= today;
      const interactive = mark || canAdd;
      grid.appendChild(el(interactive ? "button.cal__cell" : "span.cal__cell", {
        type: interactive ? "button" : undefined,
        title: mark ? mark.titles.join(", ") : canAdd ? t("cal.addOn", { date: dayLabel(key) }) : undefined,
        "aria-label": canAdd ? t("cal.addOn", { date: dayLabel(key) }) : undefined,
        class: [
          key === today && "is-today",
          mark && "is-marked",
          canAdd && "is-addable",
        ].filter(Boolean).join(" "),
        onclick: mark && onPick ? (e) => onPick(key, mark, e.currentTarget)
          : canAdd ? (e) => onAdd(key, e.currentTarget) : undefined,
      }, [
        String(date.getDate()),
        mark && el("span.cal__dot" + (mark.ids.length > 1 ? ".cal__dot--multi" : "")),
        canAdd && el("span.cal__add", { "aria-hidden": "true" }, "+"),
      ]));
    }
    onView?.(weekStart, addDays(weekStart, 6));
  }
  paint();

  return { el: root };
}

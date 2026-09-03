// Home menu: a "today" strip, an "upcoming" deadline list, Assignments | Tests
// tabs, filters, and the card grid.

import { store } from "../store.js";
import { el, clear, icon, ICONS, toast } from "../lib/dom.js";
import { t, plural, fmtDate, relativeDay, daysUntil } from "../lib/i18n.js";
import { localDayKey, questionsAnsweredToday } from "../lib/activity.js";
import { weeklyRecap, isoWeek } from "../lib/recap.js";
import { masteryByTopic, masteryForAssignment, weakSpotQuestions } from "../lib/mastery.js";
import { datePicker, monthCalendar } from "../components/calendar.js";
import { goalRing } from "../components/goal-ring.js";
import { confirmDialog } from "../components/confirm-dialog.js";
import { playFanfare } from "../lib/sound.js";

// Module-level so the choices survive a re-render (e.g. after deleting a set).
let tab = "assignment";
let subjectFilter = "all";
let sortBy = "recent";
let query = "";

export function renderMenu() {
  const topicMastery = masteryByTopic(store.attempts);

  const grid = el("div.grid");
  const chipsRow = el("div.chips");
  const countLabel = el("p.note");

  const searchInput = el("input.search__input", {
    type: "search", placeholder: t("menu.searchPlaceholder"), value: query,
    "aria-label": t("menu.searchAria"),
    oninput: (e) => { query = e.target.value; paint(); },
  });
  const searchWrap = el("div.search", {}, [icon(ICONS.search, 16), searchInput]);

  const sortSel = el("select.sortsel", {
    "aria-label": t("menu.sortAria"),
    onchange: (e) => { sortBy = e.target.value; paint(); },
  }, [
    el("option", { value: "recent" }, t("menu.sortRecent")),
    el("option", { value: "name" }, t("menu.sortName")),
    el("option", { value: "weakest" }, t("menu.sortWeakest")),
  ]);
  sortSel.value = sortBy;

  const toolsRow = el("div.tools", {}, [searchWrap, sortSel]);

  /* ---------------- painting ---------------- */

  function matchesQuery(a, q) {
    const subject = store.subjects.find((s) => s.id === a.subjectId)?.name || "";
    return (a.title + " " + subject + " " + (a.topics || []).join(" ")).toLowerCase().includes(q);
  }

  function visibleSets() {
    const q = query.trim().toLowerCase();
    let items = store.assignments.filter((a) => a.type === tab);
    if (subjectFilter !== "all") items = items.filter((a) => a.subjectId === subjectFilter);
    if (q) items = items.filter((a) => matchesQuery(a, q));
    if (sortBy === "name") items = [...items].sort((x, y) => x.title.localeCompare(y.title));
    else if (sortBy === "weakest") {
      // Lowest known mastery first. A set you've never studied has *unknown*
      // mastery, not zero, so it sorts after the ones you're measurably weak at.
      items = [...items].sort((x, y) =>
        (masteryForAssignment(x, topicMastery) ?? Infinity) - (masteryForAssignment(y, topicMastery) ?? Infinity));
    } else items = [...items].sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0));
    return items;
  }

  function kindWord(which) {
    return which === "assignment" ? t("common.assignmentsLower") : t("common.testsLower");
  }

  function paint() {
    // subject chips: subjects present in this tab, plus any the user added
    // ahead of time (dimmed until they have a set), then a "+ add" control.
    clear(chipsRow);
    const inTab = store.assignments.filter((a) => a.type === tab);
    chipsRow.appendChild(chip(t("menu.chipAll"), "all", null));
    for (const s of store.subjects) {
      const hasSets = inTab.some((a) => a.subjectId === s.id);
      if (!hasSets && !s.pinned) continue;
      const c = chip(s.name, s.id, store.subjectColor(s.id));
      if (!hasSets) c.classList.add("chip--empty");
      chipsRow.appendChild(c);
    }
    if (subjectFilter !== "all"
        && !inTab.some((a) => a.subjectId === subjectFilter)
        && !store.subjects.some((s) => s.id === subjectFilter && s.pinned)) {
      subjectFilter = "all";
    }
    chipsRow.appendChild(addSubjectChip());
    // Always shown now — it carries the "add a subject" control.
    chipsRow.hidden = false;

    // Search + sort only earn their space once there's enough to sift through —
    // but never hide them while a query is active, or the filter becomes
    // invisible state the student can't see or clear.
    toolsRow.hidden = inTab.length < 5 && !query.trim();

    const items = visibleSets();
    clear(grid);
    grid.appendChild(newCard());
    for (const a of items) grid.appendChild(card(a, topicMastery));

    // A search that misses in this tab but hits in the other is a dead end
    // unless we say so — the set the student wants is one click away.
    clear(countLabel);
    const q = query.trim().toLowerCase();
    if (q && !items.length) {
      const otherTab = tab === "assignment" ? "test" : "assignment";
      const otherHits = store.assignments.filter((a) => a.type === otherTab && matchesQuery(a, q)).length;
      countLabel.appendChild(document.createTextNode(
        t("menu.noMatch", { kind: kindWord(tab), q: query.trim() })));
      if (otherHits) {
        countLabel.appendChild(el("button.linkbtn", {
          type: "button",
          onclick: () => { switchTab(otherTab); },
        }, t(otherTab === "test" ? "menu.switchToTests" : "menu.switchToAssignments", { n: otherHits })));
      }
    }
    countLabel.hidden = !q || !!items.length;

    if (!items.length && !q) grid.appendChild(emptyState());
  }

  function chip(label, value, color) {
    return el("button.chip", {
      type: "button",
      "aria-pressed": String(subjectFilter === value),
      onclick: () => { subjectFilter = value; paint(); },
      style: color ? { "--subject": color.solid, "--subject-ink": color.ink } : {},
    }, [color && el("span.chip__dot"), label].filter(Boolean));
  }

  /** The "+ add subject" control at the end of the chip row. Click it to type a
   *  name inline; the subject is created (pinned) and selected as the filter. */
  function addSubjectChip() {
    const btn = el("button.chip.chip--add", {
      type: "button", "aria-label": t("menu.addSubject"), title: t("menu.addSubject"),
    }, [icon(ICONS.plus, 14)]);

    btn.addEventListener("click", () => {
      let done = false;
      const commit = (raw) => {
        if (done) return;
        done = true;
        const name = (raw || "").trim();
        if (!name) { paint(); return; }
        const s = store.addSubject(name);           // fires "change" → menu re-renders
        if (s) toast(t("menu.subjectAdded", { name: s.name }));
        else paint();
      };
      const inp = el("input.chip.chip--addinput", {
        type: "text", placeholder: t("menu.addSubjectPh"), "aria-label": t("menu.addSubject"),
        onblur: () => commit(inp.value),
        onkeydown: (e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(inp.value); }
          else if (e.key === "Escape") { done = true; inp.replaceWith(btn); }
        },
      });
      btn.replaceWith(inp);
      inp.focus();
    });

    return btn;
  }

  function card(a, tm) {
    const color = store.subjectColor(a.subjectId);
    const subject = store.subjects.find((s) => s.id === a.subjectId);
    const m = masteryForAssignment(a, tm);
    const attempts = store.attempts.filter((x) => x.assignmentId === a.id).length;
    const open = store.getSession(a.id);
    const openCount = open ? Object.keys(open.items || {}).length : 0;
    const subjectName = subject?.name || t("common.general");

    const menuBtn = el("button.acard__menu", {
      type: "button", "aria-label": t("menu.cardOptions", { title: a.title }), "aria-haspopup": "menu",
      onclick: (e) => { e.stopPropagation(); openCardMenu(e.currentTarget, a); },
    }, [icon(ICONS.dots, 18)]);

    const overdue = a.dueAt ? daysUntil(a.dueAt) < 0 : false;

    return el("div.acard", {
      role: "button", tabindex: "0",
      style: { "--subject": color.solid, "--subject-ink": color.ink, "--subject-tint": color.tint },
      "aria-label": t(open ? "menu.cardAriaOpen" : "menu.cardAria",
        { title: a.title, subject: subjectName, count: a.questions.length }),
      onclick: () => { location.hash = `#/session/${a.id}`; },
      onkeydown: (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); location.hash = `#/session/${a.id}`; }
      },
    }, [
      menuBtn,
      el("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap", paddingRight: "28px" } }, [
        el("span.acard__tag", {}, subjectName),
        open && el("span.acard__tag.acard__tag--open", {}, t("menu.inProgress")),
        a.dueAt && el("span", {
          class: "acard__tag acard__tag--due" + (overdue ? " acard__tag--overdue" : ""),
          title: t("menu.dueLabel", { date: fmtDate(a.dueAt) }),
        }, relativeDay(a.dueAt)),
      ].filter(Boolean)),
      el("div.acard__title", {}, a.title),
      el("div.acard__meta", {}, [
        el("span", {}, open
          ? t("menu.answeredOf", { n: openCount, total: a.questions.length })
          : plural(a.questions.length, "common.questionOne", "common.questionMany")
            + (attempts ? t("menu.doneTimes", { n: attempts }) : "")),
        m == null ? el("span", { style: { color: "var(--subject)" }, "aria-hidden": "true" }, icon(ICONS.arrow, 18))
          : ring(m, color.solid),
      ]),
    ]);
  }

  function newCard() {
    return el("button.acard.acard--new", {
      type: "button",
      onclick: () => { location.hash = "#/create"; },
    }, [icon(ICONS.plus, 22), t(tab === "assignment" ? "menu.newAssignment" : "menu.newTest")]);
  }

  function emptyState() {
    const isFirstRun = !store.assignments.length;
    return el("div.empty", { style: { gridColumn: "1 / -1" } }, [
      icon(ICONS.spark, 26),
      el("h3", { style: { marginBottom: "6px" } },
        isFirstRun ? t("menu.emptyFirstTitle")
          : t(tab === "assignment" ? "menu.emptyAssignTitle" : "menu.emptyTestTitle")),
      el("p", {}, isFirstRun ? t("menu.emptyFirstBody")
        : t(tab === "assignment" ? "menu.emptyAssignBody" : "menu.emptyTestBody")),
      el("div", { style: { display: "flex", gap: "10px", justifyContent: "center", marginTop: "16px", flexWrap: "wrap" } }, [
        el("a.btn", { href: "#/library" }, [icon(ICONS.book, 18), t("menu.libraryCta")]),
        el("a.btn.btn--ghost", { href: "#/create" }, [icon(ICONS.plus, 18), t("common.newSet")]),
        isFirstRun && store.demoStatus.loaded === 0 && el("button.btn.btn--ghost", {
          type: "button",
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            try { await store.loadDemoContent(); toast(t("menu.demoAdded")); }
            catch { toast(t("menu.demoFailed")); e.currentTarget.disabled = false; }
          },
        }, [icon(ICONS.play, 16), t("menu.tryDemo")]),
      ].filter(Boolean)),
    ]);
  }

  /* ---------------- card ⋮ menu ---------------- */

  function openCardMenu(anchor, a) {
    closeCardMenu();
    const menu = el("div.cardmenu", { role: "menu" }, [
      item(ICONS.pencil, t("menu.itemRename"), () => rename(a)),
      item(ICONS.chart, t("menu.itemEdit"), () => { location.hash = `#/edit/${a.id}`; }),
      item(ICONS.calendar, t("menu.itemDue"), () => openDueDialog(a)),
      item(ICONS.copy, t("menu.itemDuplicate"), () => {
        const copy = store.duplicateAssignment(a.id);
        if (copy) toast(t("menu.copiedAs", { title: copy.title }));
      }),
      item(ICONS.play, t("menu.itemPrint"), () => { location.hash = `#/print/${a.id}`; }),
      store.hasKey() && item(ICONS.spark, t("menu.itemMore"), () => { location.hash = `#/edit/${a.id}?more=1`; }),
      item(ICONS.trash, t("menu.itemDelete"), () => remove(a), true),
    ].filter(Boolean));

    function item(path, label, fn, danger) {
      return el("button.cardmenu__item", {
        type: "button", role: "menuitem",
        class: danger ? "cardmenu__item--danger" : "",
        onclick: (e) => { e.stopPropagation(); closeCardMenu(); fn(); },
      }, [icon(path, 15), label]);
    }

    const r = anchor.getBoundingClientRect();
    menu.style.top = `${r.bottom + window.scrollY + 4}px`;
    menu.style.left = `${Math.min(r.left + window.scrollX, window.innerWidth - 190)}px`;
    document.body.appendChild(menu);
    menu.querySelector("button")?.focus();

    setTimeout(() => {
      document.addEventListener("click", closeCardMenu, { once: true });
      document.addEventListener("keydown", escClose);
    }, 0);
  }

  function escClose(e) { if (e.key === "Escape") { closeCardMenu(); closeDueDialog(); } }

  function closeCardMenu() {
    document.querySelectorAll(".cardmenu").forEach((m) => m.remove());
    document.removeEventListener("keydown", escClose);
  }

  /* ---------------- due date dialog ---------------- */

  let dueDialog = null;
  function closeDueDialog() { dueDialog?.remove(); dueDialog = null; }

  function openDueDialog(a) {
    closeDueDialog();
    const picker = datePicker({ value: a.dueAt || "", min: localDayKey() });

    function save() {
      const v = picker.getValue();
      if (v && !store.setDueDate(a.id, v)) { toast(t("due.invalid")); return; }
      if (!v) store.setDueDate(a.id, null);
      toast(t(v ? "due.saved" : "due.cleared"));
      closeDueDialog();
    }
    function clearDate() {
      const prev = a.dueAt;
      store.setDueDate(a.id, null);
      toast(t("due.cleared"), prev ? {
        actionLabel: t("common.undo"),
        onAction: () => store.setDueDate(a.id, prev),
      } : undefined);
      closeDueDialog();
    }

    dueDialog = el("div.modal", {
      role: "dialog", "aria-modal": "true", "aria-label": t("due.title"),
      onclick: (e) => { if (e.target === dueDialog) closeDueDialog(); },
    }, [
      el("div.modal__card", {}, [
        el("h3", { style: { marginBottom: "6px" } }, t("due.title")),
        el("p.note", { style: { marginBottom: "14px" } }, t("due.body", { title: a.title })),
        picker.el,
        el("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "14px" } }, [
          el("button.btn.btn--sm", { type: "button", onclick: save }, t("due.save")),
          a.dueAt && el("button.btn.btn--ghost.btn--sm", {
            type: "button", style: { color: "var(--retry-ink)" }, onclick: clearDate,
          }, t("due.clear")),
          el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: closeDueDialog }, t("common.cancel")),
        ].filter(Boolean)),
      ]),
    ]);
    document.body.appendChild(dueDialog);
    document.addEventListener("keydown", escClose);
    picker.el.querySelector('.cal__cell[tabindex="0"]')?.focus();
  }

  function rename(a) {
    const next = prompt(t("menu.renamePrompt"), a.title);
    if (next == null) return;
    const clean = next.trim();
    if (!clean) { toast(t("menu.renameEmpty")); return; }
    if (clean === a.title) return;
    store.updateAssignment(a.id, { title: clean });
    toast(t("menu.renamed"));
  }

  async function remove(a) {
    const attempts = store.attempts.filter((x) => x.assignmentId === a.id).length;
    const msg = attempts
      ? t("menu.deleteConfirmAttempts", { title: a.title, n: attempts })
      : t("menu.deleteConfirm", { title: a.title });
    if (!(await confirmDialog({ message: msg, confirmLabel: t("common.delete"), danger: true }))) return;
    const snapshot = store.deleteAssignment(a.id);
    toast(t("menu.deleted"), snapshot ? {
      actionLabel: t("common.undo"),
      onAction: () => store.restoreAssignment(snapshot),
    } : undefined);
  }

  /* ---------------- header + tabs ---------------- */

  const tabsEl = el("div.tabs", { role: "tablist" }, [
    tabBtn(t("common.assignments"), "assignment"),
    tabBtn(t("common.tests"), "test"),
  ]);
  function tabBtn(label, value) {
    return el("button.tab", {
      role: "tab", "aria-selected": String(tab === value),
      onclick: () => switchTab(value),
    }, label);
  }
  function switchTab(value) {
    tab = value;
    tabsEl.querySelectorAll(".tab").forEach((b, i) =>
      b.setAttribute("aria-selected", String((i === 0 ? "assignment" : "test") === value)));
    paint();
  }

  paint();

  // The deadline rail is a left column beside the library — a calendar and the
  // Upcoming list, kept separate from browsing. It renders nothing when there
  // are no deadlines, and the layout falls back to a single column.
  const rail = deadlineRail();
  const cols = el(rail ? "div.home__cols" : "div.home__cols.home__cols--solo", {}, [
    rail,
    el("div.home__main", {}, [
      // Tabs and the search/sort tools are both "narrow this list" controls.
      el("div.librarybar", {}, [tabsEl, toolsRow]),
      chipsRow,
      countLabel,
      grid,
    ]),
  ].filter(Boolean));

  const node = el("div", {}, [
    el("div.home__head", {}, [
      el("div", {}, [
        el("h1", {}, greeting()),
        el("p.home__hi", {}, store.hasKey() ? t("menu.subHasKey") : t("menu.subNoKey")),
      ]),
      el("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } }, [
        el("a.btn.btn--ghost", { href: "#/library" }, [icon(ICONS.book, 18), t("menu.libraryLink")]),
        el("a.btn", { href: "#/create" }, [icon(ICONS.plus, 18), t("common.newSet")]),
      ]),
    ]),
    recapCard(),
    todayStrip(),
    cols,
  ].filter(Boolean));

  return {
    title: t("menu.title"),
    node,
    cleanup: () => { closeCardMenu(); closeDueDialog(); closeDayChooser(); },
  };
}

/* ---------------- calendar day chooser (2+ deadlines on one day) ---------- */

let dayMenuEl = null;
function dayChooserDocClick(e) { if (dayMenuEl && !dayMenuEl.contains(e.target)) closeDayChooser(); }
function dayChooserEsc(e) { if (e.key === "Escape") closeDayChooser(); }
function closeDayChooser() {
  dayMenuEl?.remove();
  dayMenuEl = null;
  document.removeEventListener("click", dayChooserDocClick, true);
  document.removeEventListener("keydown", dayChooserEsc);
}
function openDayChooser(anchor, mark) {
  closeDayChooser();
  const menu = el("div.cardmenu.daymenu", { role: "menu" },
    mark.items.map((a) => {
      const color = store.subjectColor(a.subjectId);
      return el("a.cardmenu__item", {
        href: `#/session/${a.id}`, role: "menuitem",
        onclick: () => closeDayChooser(),
      }, [
        el("span.daymenu__dot", { style: { background: color.solid } }),
        el("span", {}, a.title),
      ]);
    }));

  const r = anchor.getBoundingClientRect();
  menu.style.top = `${r.bottom + window.scrollY + 4}px`;
  menu.style.left = `${Math.max(8, Math.min(r.left + window.scrollX, window.innerWidth - 210))}px`;
  document.body.appendChild(menu);
  dayMenuEl = menu;
  menu.querySelector("a")?.focus();

  setTimeout(() => {
    document.addEventListener("click", dayChooserDocClick, true);
    document.addEventListener("keydown", dayChooserEsc);
  }, 0);
}

/** A once-a-week summary card, shown on the menu until dismissed. */
function recapCard() {
  const week = isoWeek();
  if (store.state.activity.recapWeek === week) return null;
  const r = weeklyRecap(store.state);
  if (!r) return null;

  const bits = [
    plural(r.days, "recap.daysOne", "recap.daysMany"),
    plural(r.questions, "recap.qOne", "recap.qMany"),
  ];
  if (r.topicsUp) bits.push(plural(r.topicsUp, "recap.topicsOne", "recap.topicsMany"));

  const card = el("div.recap", { role: "status" }, [
    el("div", {}, [
      el("strong", {}, t("recap.title")),
      el("span.recap__body", {}, bits.join(" · ")
        + (r.topSubject ? " · " + t("recap.strongest", { subject: r.topSubject }) : "")),
    ]),
    el("button.recap__x", {
      type: "button", "aria-label": t("common.close"),
      onclick: () => { store.dismissRecap(week); card.remove(); },
    }, "×"),
  ]);
  return card;
}

/** A compact row of what actually matters today: review, streak, weak spots,
 *  and the session you walked away from. Only the tiles that apply render. */
function todayStrip() {
  const due = store.dueQuestions().length;
  const streak = store.streak;
  const openKey = Object.keys(store.state.sessions)[0];
  const open = openKey ? store.state.sessions[openKey] : null;
  const weak = weakSpotQuestions(store.assignments, store.attempts).length;
  const tiles = [];

  // "Pick up where you left off" leads and is the loudest tile — it's the one
  // thing you almost certainly want when it's there.
  if (open) {
    const answered = Object.keys(open.items || {}).length;
    const cont = tile(
      open.retryHash || (open.isReview ? "#/review" : `#/session/${open.assignmentId}`),
      ICONS.play,
      t("menu.tileContinue"),
      t("menu.tileContinueSub", { title: open.title, n: answered, total: open.order.length }));
    cont.classList.add("tile--resume");
    tiles.push(cont);
  }

  const goal = Number(store.settings.dailyGoal) || 0;
  if (goal > 0 && store.assignments.length) tiles.push(goalTile(goal));

  if (due) {
    tiles.push(tile("#/review", ICONS.spark, t("menu.tileDue", { n: due }), t("menu.tileDueSub")));
  }

  if (weak) {
    const w = tile("#/practice-weak", ICONS.target, t("menu.tileWeak"), t("menu.tileWeakSub"));
    w.classList.add("tile--weak");
    tiles.push(w);
  }

  if (streak > 0) {
    const st = tile("#/progress", ICONS.flame, plural(streak, "menu.tileStreakOne", "menu.tileStreak"), t("menu.tileStreakSub"));
    st.classList.add("tile--streak");
    tiles.push(st);
  }

  const strip = el("div.today", {}, tiles);
  strip.hidden = !tiles.length;
  return strip;
}

function tile(href, iconPath, title, sub, accent) {
  return el(accent ? "a.tile.tile--accent" : "a.tile", { href }, [
    el("span.tile__icon", {}, icon(iconPath, 18)),
    el("span", {}, [
      el("strong", {}, title),
      el("span.tile__sub", {}, sub),
    ]),
  ]);
}

/** Today's daily-goal progress: a ring showing answered / goal. Plays a small
 *  fanfare the first time the goal is reached each day. */
function goalTile(goal) {
  const done = questionsAnsweredToday(store.attempts);
  const hit = done >= goal;

  // First time the goal is hit today: record the day (feeds the 7-day-goal
  // achievement + syncs across devices) and play the fanfare once.
  if (hit) store.markGoalReached() && playFanfare();

  return el("a.tile.tile--goal", { href: "#/progress" }, [
    goalRing(done, goal),
    el("span", {}, [
      el("strong", {}, hit ? t("menu.goalDone") : t("menu.goalToday", { done, goal })),
      el("span.tile__sub", {}, t("menu.goalSub")),
    ]),
  ]);
}

/**
 * The left rail: a mini month calendar with a dot on every day that has a
 * deadline, above the "Upcoming" list of those deadlines soonest-first.
 * Returns null when nothing is due, so the home layout falls back to one
 * column. Overdue and nearest items sort first, so the collapsed list always
 * holds the ones that matter.
 */
const UPCOMING_COLLAPSED = 3;
let upcomingExpanded = false;

function deadlineRail() {
  const items = store.upcomingDue();
  if (!items.length) return null;

  // day key -> { ids, titles, items } for the calendar dots + the day chooser.
  const marks = new Map();
  for (const a of items) {
    const m = marks.get(a.dueAt) || { ids: [], titles: [], items: [] };
    m.ids.push(a.id); m.titles.push(a.title); m.items.push(a);
    marks.set(a.dueAt, m);
  }

  const cal = monthCalendar({
    marks,
    onPick: (_day, mark, cellEl) => {
      if (mark.items.length === 1) { location.hash = `#/session/${mark.items[0].id}`; return; }
      openDayChooser(cellEl, mark);
    },
  });

  const list = el("div.upcoming__list");
  const more = items.length - UPCOMING_COLLAPSED;
  const toggle = more > 0 ? el("button.upcoming__more", { type: "button" }) : null;
  if (toggle) toggle.addEventListener("click", () => { upcomingExpanded = !upcomingExpanded; paintList(); });
  paintList();

  return el("aside.home__rail", {}, [
    el("section.upcoming", {}, [
      el("h2.upcoming__title", {}, [icon(ICONS.calendar, 18), t("menu.upcoming")]),
      cal.el,
      list,
      toggle,
    ].filter(Boolean)),
  ]);

  function paintList() {
    const shown = toggle && !upcomingExpanded ? items.slice(0, UPCOMING_COLLAPSED) : items;
    list.replaceChildren(...shown.map(row));
    if (!toggle) return;
    toggle.textContent = upcomingExpanded ? t("menu.upcomingLess") : t("menu.upcomingAll", { n: items.length });
    toggle.setAttribute("aria-expanded", String(upcomingExpanded));
  }

  function row(a) {
    const left = daysUntil(a.dueAt);
    const overdue = left < 0;
    const soon = left >= 0 && left <= 1;
    const color = store.subjectColor(a.subjectId);
    return el("a", {
      href: `#/session/${a.id}`,
      class: "upcoming__row" + (overdue ? " is-overdue" : soon ? " is-soon" : ""),
      style: { "--subject": color.solid },
      "aria-label": t("menu.upcomingStudyAria", { title: a.title }),
    }, [
      el("span.upcoming__dot"),
      el("span.upcoming__main", {}, [
        el("strong", {}, a.title),
        el("span.upcoming__meta", {}, `${fmtDate(a.dueAt)} · ${relativeDay(a.dueAt)}`),
      ]),
      el("span.upcoming__go", {}, icon(ICONS.play, 14)),
    ]);
  }
}

function ring(v, color) {
  const pct = Math.round(v * 100);
  const wrap = el("span.ring", {
    style: { "--v": pct, "--subject": color },
    title: t("menu.masteryTitle", { pct }),
  });
  wrap.innerHTML =
    `<svg viewBox="0 0 36 36" aria-hidden="true">` +
    `<circle class="ring__bg" cx="18" cy="18" r="15.9"/>` +
    `<circle class="ring__fg" cx="18" cy="18" r="15.9" pathLength="100" transform="rotate(-90 18 18)"/>` +
    `<text class="ring__label" x="18" y="18" text-anchor="middle" dominant-baseline="central">${pct}</text>` +
    `</svg>`;
  return wrap;
}

function greeting() {
  const h = new Date().getHours();
  return t(h < 12 ? "menu.morning" : h < 18 ? "menu.afternoon" : "menu.evening");
}

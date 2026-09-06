// Home menu: a "today" strip, an "upcoming" deadline list, Assignments | Tests
// tabs, filters, and the card grid.

import { store } from "../store.js";
import { el, clear, icon, ICONS, toast } from "../lib/dom.js";
import { t, plural, fmtDate, relativeDay, daysUntil } from "../lib/i18n.js";
import { localDayKey, questionsAnsweredToday } from "../lib/activity.js";
import { weeklyRecap, isoWeek } from "../lib/recap.js";
import { masteryByTopic, masteryForAssignment, weakSpotQuestions } from "../lib/mastery.js";
import { datePicker, monthCalendar, weekStrip } from "../components/calendar.js";
import { goalRing } from "../components/goal-ring.js";
import { confirmDialog } from "../components/confirm-dialog.js";
import { homeButton } from "../components/nav.js";
import { openQuickAdd, closeQuickAdd } from "../components/quick-add.js";
import { playFanfare } from "../lib/sound.js";
import { ACHIEVEMENTS, nextAchievement } from "../lib/achievements.js";
import { countdownLabel } from "../lib/date-phrases.js";

// Module-level so the choices survive a re-render (e.g. after deleting a set).
let tab = "assignment";
let subjectFilter = "all";
let sortBy = "recent";
let query = "";
let filtersOpen = false;

export function renderMenu(mode) {
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

  // Sort + subject chips live in a drawer behind a "Filter" toggle — but it
  // springs open on its own whenever a filter is actually active, so the
  // student can always see and clear what's narrowing the list.
  const filterDrawer = el("div.filterdrawer", {}, [sortSel, chipsRow]);
  const filterToggle = el("button.btn.btn--ghost.btn--sm.filtertoggle", {
    type: "button", "aria-expanded": "false",
    onclick: () => { filtersOpen = !filtersOpen; paintFilterDrawer(); },
  }, [t("menu.filter"), el("span.caret", { "aria-hidden": "true" }, "▾")]);

  function paintFilterDrawer() {
    const active = subjectFilter !== "all" || sortBy !== "recent";
    const open = filtersOpen || active;
    filterDrawer.hidden = !open;
    filterToggle.setAttribute("aria-expanded", String(open));
    filterToggle.classList.toggle("is-on", open);
  }

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
    chipsRow.hidden = false;
    paintFilterDrawer();

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
      item(ICONS.clock, t("menu.itemExam"), () => { location.hash = `#/session/${a.id}?exam=1`; }),
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

  const libraryUI = [
    el("div.librarybar", {}, [tabsEl, searchWrap, filterToggle]),
    filterDrawer,
    countLabel,
    grid,
  ];
  const menuCleanup = () => { closeCardMenu(); closeDueDialog(); closeDayChooser(); closeCalendarDialog(); closeQuickAdd(); };

  // "Study" = just the set library on its own page (reached from the nav).
  if (mode === "study") {
    return {
      title: t("menu.studyTitle"),
      node: el("div", {}, [
        homeButton(),
        el("h1", { style: { marginBottom: "4px" } }, t("menu.studyTitle")),
        el("p.note", { style: { marginBottom: "18px" } }, t("menu.studySub")),
        ...libraryUI,
      ]),
      cleanup: menuCleanup,
    };
  }

  // "Calendar" = the full month + every upcoming item, its own page (reached
  // from the nav) — unlike the home rail's collapsed copy, this one always
  // shows everything (same non-collapsible content as the "Kommande" dialog).
  if (mode === "calendar") {
    const content = deadlineRailContent({ forceCalendar: true });
    return {
      title: t("menu.calendarTitle"),
      node: el("div", {}, [
        homeButton(),
        el("div", { style: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" } }, [
          el("h1", { style: { marginBottom: "4px" } }, t("menu.calendarTitle")),
          el("button.btn.btn--sm", {
            type: "button",
            onclick: () => openQuickAdd(localDayKey()),
          }, [icon(ICONS.plus, 16), t("quickadd.newDeadline")]),
        ]),
        el("p.note", { style: { marginBottom: "18px" } }, t("menu.calendarSub")),
        el("div.calendarpage", {}, [content.el]),
      ]),
      cleanup: menuCleanup,
    };
  }

  // "Dina set" — one panel holding everything about browsing the library:
  // tabs, search, the Filter drawer, and the card grid.
  const setsPanel = el("section.home-panel.home-panel--sets", {}, [
    el("div.home-panel__label", {}, [el("span", {}, t("menu.panelSets"))]),
    ...libraryUI,
  ]);

  // The greeting stays at the very top, full width.
  const greetingBlock = el("div.home__head", {}, [
    el("h1", {}, greeting()),
    el("p.home__hi", {}, store.hasKey() ? t("menu.subHasKey") : t("menu.subNoKey")),
  ]);

  // The Solve / Library / New-set shortcuts sit *below* the "Idag" panel — a
  // returning user sees their status (continue, due, streak) first, then the
  // ways to add material. Solve first, New-set last (the primary); in demo
  // mode a Library shortcut slots in between rather than jumping the queue.
  const headActions = el("div.home__actions", {}, [
    el("a.btn.btn--ghost", { href: "#/solve" }, [icon(ICONS.camera, 18), t("menu.solveLink")]),
    !store.hasKey() && el("a.btn.btn--ghost", { href: "#/library" }, [icon(ICONS.book, 18), t("nav.library")]),
    el("a.btn", { href: "#/create" }, [icon(ICONS.plus, 18), t("common.newSet")]),
  ].filter(Boolean));

  // Right-hand rail: upcoming deadlines (calendar) + an achievements teaser.
  // Nothing to show yet (fresh library, everything unlocked with no next
  // badge) → no rail, and the layout falls back to one column.
  const rail = homeRail();
  const layout = el(rail ? "div.home-layout" : "div.home-layout.home-layout--solo", {}, [
    el("div.home-main", {}, [todayPanel(), headActions, setsPanel].filter(Boolean)),
    rail,
  ].filter(Boolean));

  return { title: t("menu.title"), node: el("div", {}, [greetingBlock, layout]), cleanup: menuCleanup };
}

/** The right-hand rail on the home page: a mini calendar + Upcoming list
 *  (only while there are deadlines) and an achievements teaser (the badge
 *  closest to unlocking, or a "you got them all" note). Null when both are
 *  empty, so the layout collapses to one column. */
function homeRail() {
  const panels = [calendarPanel(), achievementsPanel()].filter(Boolean);
  return panels.length ? el("aside.home-rail", {}, panels) : null;
}

function calendarPanel() {
  const content = deadlineRailContent({ collapsible: true });
  if (!content) return null;
  return el("section.home-panel.home-panel--cal", {}, [
    el("div.home-panel__label", {}, [
      el("span", {}, t("menu.upcoming")),
      content.calToggle,
    ].filter(Boolean)),
    content.el,
  ]);
}

function achievementsPanel() {
  const unlockedMap = store.unlockedAchievements;
  const unlocked = ACHIEVEMENTS.filter((a) => a.id in unlockedMap).length;
  const next = nextAchievement(store.state);

  return el("section.home-panel.home-panel--ach", {}, [
    el("div.home-panel__label", {}, [
      el("span", {}, t("prog.achievements")),
      el("a.linkbtn", { href: "#/achievements" }, t("ach.subtitle", { unlocked, total: ACHIEVEMENTS.length })),
    ]),
    next
      ? el("div.ach-next", {}, [
          el("span.ach-next__emoji", { "aria-hidden": "true" }, icon(ICONS[next.def.icon] || ICONS.award, 24)),
          el("div", { style: { flex: "1", minWidth: "0" } }, [
            el("strong", {}, `${t(`ach.tier.${next.def.tier}`)} · ${t(next.def.nameKey)}`),
            el("div.ach-next__bar", {}, [
              el("div.ach-next__fill", { style: { width: `${Math.min(100, Math.round((next.have / next.need) * 100))}%` } }),
            ]),
            el("span.note", {}, `${next.have} / ${next.need}`),
          ]),
        ])
      : el("p.note", {}, t("menu.achAllDone")),
  ]);
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

/**
 * The "Idag" panel: a slim weekly recap, the "continue where you left off"
 * banner, a row of small stat pills (goal · due · weak · streak), and — when
 * there are deadlines — a "Kommande (N)" button that opens the calendar.
 * Renders nothing when there's genuinely nothing to say.
 */
function todayPanel() {
  const due = store.dueQuestions().length;
  const streak = store.streak;
  const openKey = Object.keys(store.state.sessions)[0];
  const open = openKey ? store.state.sessions[openKey] : null;
  const weak = weakSpotQuestions(store.assignments, store.attempts).length;
  const goal = Number(store.settings.dailyGoal) || 0;
  const showGoal = goal > 0 && store.assignments.length;
  const upcoming = store.upcomingDue();
  const recap = recapCard();

  if (!open && !showGoal && !due && !weak && streak <= 0 && !recap && !upcoming.length) return null;

  const pills = [];
  if (showGoal) pills.push(goalPill(goal));
  if (due) pills.push(statPill("#/review", ICONS.spark, t("menu.tileDue", { n: due }), "pill--due"));
  if (weak) pills.push(statPill("#/practice-weak", ICONS.target,
    plural(weak, "menu.tileWeakOne", "menu.tileWeakMany"), "pill--weak"));
  if (streak > 0) pills.push(statPill("#/progress", ICONS.flame,
    plural(streak, "menu.tileStreakOne", "menu.tileStreak"), "pill--streak"));

  const kommandeBtn = upcoming.length
    ? el("button.btn.btn--ghost.btn--sm", {
        type: "button", onclick: () => openCalendarDialog(),
      }, [icon(ICONS.calendar, 15), t("menu.upcomingCount", { n: upcoming.length })])
    : null;

  // Order by what a returning student acts on: resume first, then what's due /
  // the streak, and the week's reflection last (it's read once, not clicked).
  return el("section.home-panel.home-panel--today", {}, [
    el("div.home-panel__label", {}, [el("span", {}, t("menu.panelToday")), kommandeBtn].filter(Boolean)),
    open ? continueBanner(open) : null,
    pills.length ? el("div.pillrow", {}, pills) : null,
    recap,
  ].filter(Boolean));
}

function continueBanner(open) {
  const answered = Object.keys(open.items || {}).length;
  const href = open.retryHash || (open.isReview ? "#/review" : `#/session/${open.assignmentId}`);
  // Prefer the set's current title over the snapshot's — a demo/library set
  // renamed by a language switch (e.g. "Antikens Rom – prov" → "Ancient Rome
  // Quiz") would otherwise show its stale title here until the run finishes.
  const title = store.getAssignment(open.assignmentId)?.title || open.title;
  return el("a.continue-banner", { href }, [
    el("span.continue-banner__ic", {}, icon(ICONS.play, 20)),
    el("span.continue-banner__body", {}, [
      el("strong", {}, t("menu.tileContinue")),
      el("span", {}, t("menu.tileContinueSub", { title, n: answered, total: open.order.length })),
    ]),
    el("span.continue-banner__go", {}, t("menu.resumeGo")),
  ]);
}

function statPill(href, iconPath, label, cls) {
  return el(`a.pill.${cls}`, { href }, [
    el("span.pill__ic", {}, icon(iconPath, 14)),
    el("span", {}, label),
  ]);
}

/** Daily-goal pill: a small ring + count. Plays a fanfare the first time the
 *  goal is reached each day (same side effect the old tile carried). */
function goalPill(goal) {
  const done = questionsAnsweredToday(store.attempts);
  const hit = done >= goal;
  if (hit) store.markGoalReached() && playFanfare();
  return el("a.pill.pill--goal", { href: "#/progress" }, [
    goalRing(done, goal),
    el("span", {}, hit ? t("menu.goalDone", { done }) : t("menu.goalToday", { done, goal })),
  ]);
}

/**
 * A calendar (a dot on every day with a deadline) above the "Upcoming" list,
 * soonest-first. Full month in the "Kommande" dialog; the home-rail copy
 * defaults to a single collapsed week, expandable to the full month.
 * Returns null when nothing is due.
 */
const UPCOMING_COLLAPSED = 3;
let upcomingExpanded = false;
let calendarExpanded = false;

let calDialogEl = null;
function calDialogEsc(e) { if (e.key === "Escape") closeCalendarDialog(); }
function closeCalendarDialog() {
  calDialogEl?.remove();
  calDialogEl = null;
  document.removeEventListener("keydown", calDialogEsc);
}
function openCalendarDialog() {
  closeCalendarDialog();
  const content = deadlineRailContent();
  if (!content) return;
  calDialogEl = el("div.modal", {
    role: "dialog", "aria-modal": "true", "aria-label": t("menu.upcoming"),
    onclick: (e) => { if (e.target === calDialogEl) closeCalendarDialog(); },
  }, [
    el("div.modal__card.caldialog", {}, [
      el("div.caldialog__head", {}, [
        el("h3", {}, [icon(ICONS.calendar, 18), t("menu.upcoming")]),
        el("button.iconbtn.iconbtn--sm", { type: "button", "aria-label": t("common.close"), onclick: closeCalendarDialog }, "×"),
      ]),
      content.el,
    ]),
  ]);
  document.body.appendChild(calDialogEl);
  document.addEventListener("keydown", calDialogEsc);
  calDialogEl.querySelector(".cal__cell, .upcoming__row, button")?.focus();
}

function deadlineRailContent({ collapsible = false, forceCalendar = false } = {}) {
  const items = store.upcomingDue();
  if (!items.length && !forceCalendar) return null;

  // items is soonest-first, so the first test in it is the next one due.
  // Shown as a countdown + study shortcut under the calendar — independent
  // of which week/month the calendar is currently paged to.
  const nextTest = items.find((a) => a.type === "test");

  // day key -> { ids, titles, items } for the calendar dots + the day chooser.
  const marks = new Map();
  for (const a of items) {
    const m = marks.get(a.dueAt) || { ids: [], titles: [], items: [] };
    m.ids.push(a.id); m.titles.push(a.title); m.items.push(a);
    marks.set(a.dueAt, m);
  }

  const onPick = (_day, mark, cellEl) => {
    if (mark.items.length === 1) { closeCalendarDialog(); location.hash = `#/session/${mark.items[0].id}`; return; }
    openDayChooser(cellEl, mark);
  };

  // Tap an empty future day → name a set for that deadline.
  const onAdd = (day) => { closeCalendarDialog(); openQuickAdd(day); };

  // Only the home-rail copy collapses to a single, navigable week — the
  // "Kommande" dialog is an explicit "show me everything" action, so it
  // always gets the full month with no toggle, and its list is never
  // filtered down to whatever's currently paged in.
  const calWrap = el("div.cal-collapse");
  const calEmpty = collapsible ? el("p.note.cal-empty", {}, t("menu.calendarEmptyWeek")) : null;
  const calToggle = collapsible ? el("button.linkbtn.cal-collapse__toggle", { type: "button" }) : null;
  if (calToggle) calToggle.addEventListener("click", () => { calendarExpanded = !calendarExpanded; paintCal(); });

  const list = el("div.upcoming__list");
  const more = el("button.upcoming__more", { type: "button" });
  more.addEventListener("click", () => { upcomingExpanded = !upcomingExpanded; paintList(visibleItems); });

  // The rail's list always mirrors whichever week/month the calendar is
  // currently showing; the dialog's onView never fires, so it keeps the
  // full sorted list.
  let visibleItems = items;
  paintCal();
  if (!collapsible) paintList(visibleItems);

  // Nothing scheduled but the calendar is still shown (the #/calendar page):
  // just the month + a hint, no "next test" line or list.
  const emptyForced = forceCalendar && !items.length;

  return {
    el: el("section.upcoming", {}, [
      calEmpty,
      calWrap,
      emptyForced ? null : nextTestLine(nextTest),
      emptyForced ? null : list,
      emptyForced ? null : more,
    ].filter(Boolean)),
    calToggle,
  };

  function paintCal() {
    const expanded = !collapsible || calendarExpanded;
    clear(calWrap);
    if (expanded) {
      calWrap.appendChild(monthCalendar({ marks, onPick, onAdd, onView: collapsible ? onMonthView : undefined }).el);
      if (calEmpty) calEmpty.hidden = true;
    } else {
      calWrap.appendChild(weekStrip({ marks, onPick, onAdd, onView: onWeekView }).el);
    }
    if (calToggle) {
      calToggle.textContent = expanded ? t("menu.calendarShowWeek") : t("menu.calendarShowMonth");
      calToggle.setAttribute("aria-expanded", String(expanded));
    }
  }

  function onWeekView(start, end) {
    visibleItems = items.filter((a) => a.dueAt >= start && a.dueAt <= end);
    if (calEmpty) calEmpty.hidden = visibleItems.length > 0;
    paintList(visibleItems);
  }

  function onMonthView(start, end) {
    visibleItems = items.filter((a) => a.dueAt >= start && a.dueAt <= end);
    paintList(visibleItems);
  }

  function paintList(shownItems) {
    const overflow = shownItems.length - UPCOMING_COLLAPSED;
    const shown = overflow > 0 && !upcomingExpanded ? shownItems.slice(0, UPCOMING_COLLAPSED) : shownItems;
    list.replaceChildren(...shown.map(row));
    more.hidden = overflow <= 0;
    if (overflow > 0) {
      more.textContent = upcomingExpanded ? t("menu.upcomingLess") : t("menu.upcomingAll", { n: shownItems.length });
      more.setAttribute("aria-expanded", String(upcomingExpanded));
    }
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
      onclick: () => closeCalendarDialog(),
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

/** Countdown + one-tap shortcut to the soonest test, sat under the
 *  calendar, with a small "Prep" link through to its exam-prep page.
 *  Days elsewhere, but hours once it's due today. Null when no test has a
 *  due date — an assignment-only calendar shows nothing here. */
function nextTestLine(a) {
  if (!a) return null;
  const d = daysUntil(a.dueAt);
  const soon = d <= 1;
  const card = el("a.next-test" + (soon ? ".next-test--soon" : ""), {
    href: `#/session/${a.id}`,
    "aria-label": t("menu.upcomingStudyAria", { title: a.title }),
    onclick: () => closeCalendarDialog(),
  }, [
    el("span.next-test__when", {}, [icon(ICONS.clock, 14), el("span", {}, countdownLabel(a.dueAt))]),
    el("span.next-test__title", {}, a.title),
    el("span.next-test__go", {}, icon(ICONS.play, 14)),
  ]);
  return el("div.next-test-wrap", {}, [
    card,
    a.subjectId ? el("a.next-test__prep", {
      href: `#/exam-prep/${a.subjectId}`,
      onclick: () => closeCalendarDialog(),
    }, [icon(ICONS.target, 13), t("exam.prepLink")]) : null,
  ].filter(Boolean));
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

// Home menu: a "today" strip, an "upcoming" deadline list, Assignments | Tests
// tabs, filters, and the card grid.

import { store } from "../store.js";
import { el, clear, icon, ICONS, toast, downloadText } from "../lib/dom.js";
import { t, plural, fmtDate, relativeDay, daysUntil, getLang } from "../lib/i18n.js";
import { importSet } from "../data/library.js";
import { loadLibraryIndex, loadLibraryTranslations, baseSubjectName } from "../lib/library-content.js";
import { localDayKey } from "../lib/activity.js";
import { masteryByTopic, masteryForAssignment } from "../lib/mastery.js";
import { monthCalendar, weekStrip } from "../components/calendar.js";
import { homeButton } from "../components/nav.js";
import { isAiSet } from "../components/ai-mark.js";
import { openDueDialog, closeDueDialog } from "../components/due-dialog.js";
import { openQuickAdd, closeQuickAdd } from "../components/quick-add.js";
import { ACHIEVEMENTS } from "../lib/achievements.js";
import { achNext } from "../components/ach-next.js";
import { countdownLabel } from "../lib/date-phrases.js";
import { upcomingExams } from "../lib/exam.js";
import { prepFor, taskHash, taskLabel, shortCountdown, resumeFor, taskButtonLabel } from "../components/exam-flow.js";
import { testsTomorrow } from "../lib/tonight.js";
import { dailySlot } from "../components/daily-card.js";
import { houseAd } from "../components/house-ad.js";
import { hasSummary, openSummary } from "../components/set-summary.js";
import { daypart } from "../components/home-backdrop.js";
import { tonightPlan } from "./tonight.js";
import { shareSet } from "../lib/share-set.js";
import { loadScript, scriptKey } from "../lib/podcast.js";
import { MY_REVIEW_URL } from "../config.js";

// Module-level so the choices survive a re-render (e.g. after deleting a set).
let tab = "assignment";
let subjectFilter = "all";
let sortBy = "recent";
let query = "";
let filtersOpen = false;
// "Välj": picking several sets to delete at once. Kept outside renderMenu because the screen is rebuilt on
// every store change; the ids of sets that are gone are dropped at the next paint.
let selecting = false;
const selected = new Set();
// How many sets the home page previews on a phone before "See all" (the rest are on Studera).
const HOME_PREVIEW = 4;

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

  // Sort + subject chips live in a drawer behind a "Filter" toggle that always opens and closes it.
  // A filter left on shows as a count on the button, so a closed drawer never hides why the list is
  // shorter, and "Clear filters" in the drawer puts both back in one tap.
  const filterCount = el("span.filtertoggle__n", { hidden: true });
  const clearFilters = el("button.linkbtn", {
    type: "button", hidden: true,
    onclick: () => { subjectFilter = "all"; sortBy = "recent"; sortSel.value = sortBy; paint(); },
  }, t("menu.filterClear"));
  const filterDrawer = el("div.filterdrawer", {}, [el("div.filterdrawer__row", {}, [sortSel, clearFilters]), chipsRow]);
  const filterToggle = el("button.btn.btn--ghost.btn--sm.filtertoggle", {
    type: "button", "aria-expanded": "false",
    onclick: () => { filtersOpen = !filtersOpen; paintFilterDrawer(); },
  }, [t("menu.filter"), filterCount, el("span.caret", { "aria-hidden": "true" }, "▾")]);

  // Select mode: a toggle in the bar, and above the cards a row with the count, "Select all" and Delete.
  const selectToggle = el("button.btn.btn--ghost.btn--sm.selecttoggle", {
    type: "button", "aria-pressed": "false",
    onclick: () => { selecting = !selecting; selected.clear(); paint(); },
  });
  // A floating bar at the bottom of the screen while picking: the count, "Select all" and Delete, always in
  // reach however far down the list you are.
  const selectNum = el("b.selectbar__num");
  const selectCount = el("span.selectbar__n", { "aria-live": "polite" });
  const selectAll = el("button.selectbar__all", { type: "button", onclick: () => {
    const ids = visibleSets().map((a) => a.id);
    const all = ids.length && ids.every((id) => selected.has(id));
    if (all) ids.forEach((id) => selected.delete(id)); else ids.forEach((id) => selected.add(id));
    syncPicks();
  } });
  const deleteSelected = el("button.selectbar__del", { type: "button", onclick: () => removeMany([...selected]) },
    [icon(ICONS.trash, 16), el("span", {}, t("common.delete"))]);
  const selectBar = el("div.selectbar", { hidden: true, role: "toolbar", "aria-label": t("menu.select") }, [
    el("span.selectbar__info", {}, [selectNum, selectCount]), selectAll, deleteSelected,
  ]);

  function paintSelect(items) {
    const inTab = store.assignments.some((a) => a.type === tab);
    if (!inTab) selecting = false;
    for (const id of [...selected]) if (!items.some((a) => a.id === id)) selected.delete(id);
    selectToggle.hidden = !inTab;
    selectToggle.textContent = t(selecting ? "common.cancel" : "menu.select");
    selectToggle.setAttribute("aria-pressed", String(selecting));
    selectBar.hidden = !selecting;
    const n = selected.size;
    selectBar.classList.toggle("has-picks", n > 0);
    selectNum.textContent = String(n);
    selectNum.hidden = !n;
    selectCount.textContent = n ? t(n === 1 ? "menu.selectedOne" : "menu.selectedMany") : t("menu.selectHint");
    selectAll.textContent = t(items.length && items.every((a) => selected.has(a.id)) ? "menu.selectNone" : "menu.selectAll");
    deleteSelected.disabled = !n;
    deleteSelected.setAttribute("aria-label", n ? plural(n, "menu.deleteSelectedOne", "menu.deleteSelectedMany") : t("common.delete"));
  }

  // A pick changes the cards in place: rebuilding the grid on every tap made it blink and the page jump.
  function syncPicks() {
    for (const c of grid.querySelectorAll(".acard[data-set]")) {
      const on = selected.has(c.dataset.set);
      if (c.classList.contains("is-picked") === on) continue;
      c.classList.toggle("is-picked", on);
      c.setAttribute("aria-checked", String(on));
      const check = c.querySelector(".acard__check");
      if (check) check.replaceChildren(...(on ? [icon(ICONS.check, 16)] : []));
    }
    paintSelect(visibleSets());
  }

  function paintFilterDrawer() {
    const active = Number(subjectFilter !== "all") + Number(sortBy !== "recent");
    filterDrawer.hidden = !filtersOpen;
    filterToggle.setAttribute("aria-expanded", String(filtersOpen));
    filterToggle.setAttribute("aria-label", active ? plural(active, "menu.filterOnOne", "menu.filterOnMany") : t("menu.filter"));
    filterToggle.classList.toggle("is-on", filtersOpen || active > 0);
    filterCount.hidden = !active;
    filterCount.textContent = String(active);
    clearFilters.hidden = !active;
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
    paintSelect(items);
    grid.classList.toggle("is-selecting", selecting);
    clear(grid);
    // First run: the empty state below already offers it. The Studera page has it as a button in its header.
    if (store.assignments.length && mode !== "study" && !selecting) grid.appendChild(newCard());
    // On a phone the home page shows the first four as a preview and links on to Studera (CSS hides the
    // rest); while searching, or picking sets to delete, it shows every one ("Select all" must never
    // take a set the student can't see).
    items.forEach((a, i) => {
      const c = card(a, topicMastery);
      if (mode !== "study" && i >= HOME_PREVIEW && !query.trim() && !selecting) c.classList.add("acard--extra");
      grid.appendChild(c);
    });

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
    const resume = resumeFor(a);
    const open = resume?.session || null;
    const openCount = resume?.answered || 0;
    const subjectName = subject?.name || t("common.general");

    const menuBtn = el("button.acard__menu", {
      type: "button", "aria-label": t("menu.cardOptions", { title: a.title }), "aria-haspopup": "menu",
      onclick: (e) => { e.stopPropagation(); openCardMenu(e.currentTarget, a); },
    }, [icon(ICONS.dots, 18)]);

    const overdue = a.dueAt ? daysUntil(a.dueAt) < 0 : false;
    const ai = isAiSet(a);
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    // What's going on with it, above the footer: its deadline, and a run left part-way with how far it got.
    const status = [
      a.dueAt && el("div.acard__status" + (overdue ? ".is-late" : ""), { title: t("menu.dueLabel", { date: fmtDate(a.dueAt) }) },
        [icon(ICONS.calendar, 13), el("span", {}, cap(relativeDay(a.dueAt)))]),
      open && el("div.acard__status.is-open", {},
        [icon(ICONS.play, 12), el("span", {}, `${t("menu.inProgress")} · ${t("menu.answeredOf", { n: openCount, total: a.questions.length })}`)]),
      open && el("div.acard__progress", { "aria-hidden": "true" },
        [el("i", { style: { width: `${Math.min(100, Math.round((openCount / Math.max(1, a.questions.length)) * 100))}%` } })]),
    ].filter(Boolean);

    const picked = selecting && selected.has(a.id);
    const activate = () => {
      if (!selecting) { location.hash = resume?.hash || `#/session/${a.id}`; return; }
      if (selected.has(a.id)) selected.delete(a.id); else selected.add(a.id);
      syncPicks();
    };
    return el("div.acard" + (ai ? ".acard--ai" : "") + (picked ? ".is-picked" : ""), {
      role: selecting ? "checkbox" : "button", tabindex: "0", "data-set": a.id,
      ...(selecting ? { "aria-checked": String(picked) } : {}),
      style: { "--subject": color.solid, "--subject-ink": color.ink, "--subject-text": color.text, "--subject-tint": color.tint },
      "aria-label": selecting ? a.title : t(open ? "menu.cardAriaOpen" : "menu.cardAria",
        { title: a.title, subject: subjectName, count: a.questions.length }),
      onclick: activate,
      onkeydown: (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); }
      },
    }, [
      selecting ? el("span.acard__check", { "aria-hidden": "true" }, picked ? icon(ICONS.check, 16) : null) : menuBtn,
      // The subject as a dot in its colour and a name that trims on one line, so a long one ("XYZ – Matematisk
      // problemlösning") never wraps and every title starts at the same height.
      el("div.acard__top", {}, [
        el("span.acard__subject", { title: subjectName }, [el("span.acard__dot"), el("span.acard__subjectname", {}, subjectName)]),
        ai && el("span.acard__tag.acard__tag--ai", { title: t("menu.aiMadeTitle") }, [icon(ICONS.spark, 12), t("menu.aiMade")]),
      ].filter(Boolean)),
      el("div.acard__title", { title: a.title }, a.title),
      el("div.acard__foot", {}, [
        ...status,
        el("div.acard__meta", {}, [
          el("span", {}, plural(a.questions.length, "common.questionOne", "common.questionMany")
            + (attempts ? t("menu.doneTimes", { n: attempts }) : "")),
          m == null ? el("span", { style: { color: "var(--subject)" }, "aria-hidden": "true" }, icon(ICONS.arrow, 18))
            : ring(m, color.solid),
        ]),
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
    return el("div.empty" + (isFirstRun ? ".empty--first" : ""), { style: { gridColumn: "1 / -1" } }, [
      icon(ICONS.book, 26),
      el("h3", { style: { marginBottom: "6px" } },
        isFirstRun ? t("menu.emptyFirstTitle")
          : t(tab === "assignment" ? "menu.emptyAssignTitle" : "menu.emptyTestTitle")),
      el("p", {}, isFirstRun ? t("menu.emptyFirstBody")
        : t(tab === "assignment" ? "menu.emptyAssignBody" : "menu.emptyTestBody")),
      el("div", { style: { display: "flex", gap: "10px", justifyContent: "center", marginTop: "16px", flexWrap: "wrap" } }, [
        el("a.btn" + (isFirstRun && mode !== "study" ? ".btn--ghost" : ""), { href: "#/library" }, [icon(ICONS.book, 18), t("menu.libraryCta")]),
        el("a.btn.btn--ghost", { href: "#/create" }, [icon(ICONS.plus, 18), t("common.newSet")]),
      ]),
    ]);
  }

  /* ---------------- card ⋮ menu ---------------- */

  function openCardMenu(anchor, a) {
    closeCardMenu();
    const menu = el("div.cardmenu", { role: "menu" }, [
      hasSummary(a) && item(ICONS.fileText, t("summary.read"), () => openSummary(a, { startHref: `#/session/${a.id}` })),
      item(ICONS.pencil, t("menu.itemRename"), () => rename(a)),
      item(ICONS.chart, t("menu.itemEdit"), () => { location.hash = `#/edit/${a.id}`; }),
      item(ICONS.clock, t("menu.itemExam"), () => { location.hash = `#/session/${a.id}?exam=1`; }),
      item(ICONS.calendar, t("menu.itemDue"), () => openDueDialog(a)),
      item(ICONS.copy, t("menu.itemDuplicate"), () => {
        const copy = store.duplicateAssignment(a.id);
        if (copy) toast(t("menu.copiedAs", { title: copy.title }));
      }),
      item(ICONS.play, t("menu.itemPrint"), () => { location.hash = `#/print/${a.id}`; }),
      (store.canUseAI() || loadScript(scriptKey(a))) && (a.questions?.length || 0) > 0 && item(ICONS.headphones, t("menu.itemTalk"), () => import("../components/talk-player.js").then((m) => m.openTalk(a), () => toast(t("common.openFailed")))),
      item(ICONS.share, t("menu.itemShare"), () => shareSet(a)),
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

  function rename(a) {
    const next = prompt(t("menu.renamePrompt"), a.title);
    if (next == null) return;
    const clean = next.trim();
    if (!clean) { toast(t("menu.renameEmpty")); return; }
    if (clean === a.title) return;
    store.updateAssignment(a.id, { title: clean });
    toast(t("menu.renamed"));
  }

  // Deleting asks nothing: the student's results stay in their history, and "Ångra" in the toast puts the
  // set back with its review schedule (store.deleteAssignment / restoreAssignment). The toast stays up while
  // the pointer or keyboard is on it.
  function remove(a) {
    const snapshot = store.deleteAssignment(a.id);
    toast(t("menu.deletedOne", { title: a.title }), snapshot ? {
      actionLabel: t("common.undo"),
      onAction: () => store.restoreAssignment(snapshot),
    } : undefined);
  }

  /** "Ta bort (3)" in select mode: all at once, and one "Ångra" puts every one back. */
  function removeMany(ids) {
    if (!ids.length) return;
    selecting = false;
    selected.clear();
    const snapshots = ids.map((id) => store.deleteAssignment(id)).filter(Boolean);
    if (!snapshots.length) { paint(); return; }
    toast(snapshots.length === 1 ? t("menu.deletedOne", { title: snapshots[0].assignment.title }) : t("menu.deletedMany", { n: snapshots.length }), {
      actionLabel: t("common.undo"),
      // Back in the order they were in: restoreAssignment puts each one first in the list.
      onAction: () => { for (const s of [...snapshots].reverse()) store.restoreAssignment(s); },
    });
  }

  /* ---------------- header + tabs ---------------- */

  const tabsEl = el("div.tabs", { role: "tablist" }, [
    tabBtn(t("common.assignments"), "assignment"),
    tabBtn(t("common.tests"), "test"),
  ]);
  function tabBtn(label, value) {
    const n = store.assignments.filter((a) => a.type === value).length;
    return el("button.tab", {
      role: "tab", "aria-selected": String(tab === value),
      onclick: () => switchTab(value),
    }, [label, n ? el("span.tab__n", {}, String(n)) : null]);
  }
  // The Studera page's "+ New" sits in its header and follows the tab.
  const newLabel = el("span", {}, t(tab === "assignment" ? "menu.newAssignment" : "menu.newTest"));
  function switchTab(value) {
    tab = value;
    tabsEl.querySelectorAll(".tab").forEach((b, i) =>
      b.setAttribute("aria-selected", String((i === 0 ? "assignment" : "test") === value)));
    newLabel.textContent = t(tab === "assignment" ? "menu.newAssignment" : "menu.newTest");
    paint();
  }

  paint();

  const libraryUI = [
    el("div.librarybar", {}, [tabsEl, searchWrap, filterToggle, selectToggle]),
    filterDrawer,
    countLabel,
    selectBar,
    grid,
  ];
  // The screen is rebuilt on every store change (a sync, a subject removed in the quick-add dialog): the
  // quick-add dialog stays open through that and closes only when you leave the screen.
  const onHome = () => ["", "/", "/study"].includes(location.hash.replace(/^#/, "").split("?")[0]);
  // Leaving for another screen also ends select mode, so it isn't still on when the student comes back.
  const menuCleanup = () => {
    closeCardMenu(); closeDueDialog(); closeDayChooser();
    if (!onHome()) { closeQuickAdd(); selecting = false; selected.clear(); }
  };

  // "Study" = just the set library on its own page (reached from the nav).
  if (mode === "study") {
    return {
      title: t("menu.studyTitle"),
      node: el("div.study-page", {}, [
        homeButton(),
        el("div.planner-page__head", {}, [
          el("h1", {}, t("menu.studyTitle")),
          el("a.btn.btn--sm", { href: "#/create" }, [icon(ICONS.plus, 16), newLabel]),
        ]),
        el("p.note.study-page__sub", {}, t("menu.studySub")),
        ...libraryUI,
      ]),
      cleanup: menuCleanup,
    };
  }

  // The dedicated #/calendar page lives in js/views/calendar.js now — a full
  // month planner with the deadlines drawn in and an agenda rail — so it's no
  // longer a mode of renderMenu(). deadlineRailContent() below still powers
  // the home rail's collapsed week and the "Kommande" dialog.

  // "Dina set" — one panel holding everything about browsing the library:
  // tabs, search, the Filter drawer, and the card grid.
  const setCount = store.assignments.length;
  const setsPanel = el("section.home-panel.home-panel--sets", {}, [
    el("div.home-panel__label", {}, [
      el("span", {}, t("menu.panelSets")),
      // Phones (CSS): the panel is a preview of the first few, so it says where the rest are.
      setCount > HOME_PREVIEW ? el("a.linkbtn.home-panel__all", { href: "#/study" }, t("menu.seeAllSets", { n: setCount })) : null,
    ].filter(Boolean)),
    ...libraryUI,
  ]);

  // The page head: a greeting and one question, then the big shortcuts under it
  // (homeTiles) do the job the head's buttons used to.
  const greetingBlock = homeHead();

  // Right-hand rail: upcoming deadlines (calendar) + an achievements teaser.
  // Nothing to show yet (fresh library, everything unlocked with no next
  // badge) → no rail, and the layout falls back to one column.
  const rail = homeRail();
  // Only once there's at least one set: homeStarter() above already covers the empty state with
  // its own "pick a set" call to action, and showing this too would just repeat it.
  const ad = store.assignments.length ? houseAd() : null;
  const layout = el(rail ? "div.home-layout" : "div.home-layout.home-layout--solo", {}, [
    // The rail starts level with the greeting, up in the corner, rather than
    // under a full-width head.
    el("div.home-main", {}, [greetingBlock, continueCard(), nextTestCard(), tonightCard(), dailySlot(), homeTiles(), homeStarter(), ad, setsPanel].filter(Boolean)),
    rail,
  ].filter(Boolean));

  return { title: t("menu.title"), node: layout, cleanup: menuCleanup };
}

/** The evening before a test the home page leads with a calm card that opens the
 *  short evening plan (#/tonight). Nothing at all on any other day. */
function tonightCard() {
  const test = testsTomorrow(store.assignments)[0];
  if (!test) return null;
  const plan = tonightPlan(test);
  const name = plan.subject?.name || test.title;
  const finished = !!plan.day.finishedAt;
  return el("a.tonightcard.theme-night" + (finished ? ".tonightcard--done" : ""), { href: `#/tonight/${test.id}` }, [
    el("span.tonightcard__moon", { "aria-hidden": "true" }, [icon(ICONS.moon, 22)]),
    el("span.tonightcard__text", {}, [
      el("strong", {}, t("tonight.cardTitle", { subject: name })),
      el("span", {}, finished ? t("tonight.cardDone")
        : plan.minutes.total ? t("tonight.cardBody", { n: plan.minutes.total }) : t("tonight.leadNone")),
    ]),
    el("span.tonightcard__cta", {}, finished ? t("tonight.cardOpen") : t("tonight.cardCta")),
  ]);
}

/** The right-hand rail on the home page: the backup and review nudges when due, an always-present mini calendar +
 *  Upcoming list, and an achievements teaser (the badge closest to
 *  unlocking, or a "you got them all" note). */
function homeRail() {
  const panels = [backupPanel(), reviewPanel(), calendarPanel(), achievementsPanel()].filter(Boolean);
  return panels.length ? el("aside.home-rail", {}, panels) : null;
}

/** "Your work is only on this device." — for a signed-out student with real
 *  history and no recent backup. One tap to export, or a nudge to sign in.
 *  Dismissible; re-armed after a few weeks. */
function backupPanel() {
  if (!store.shouldNudgeBackup()) return null;
  const last = store.state.activity.lastBackupAt;
  const when = last
    ? t("backup.last", { date: fmtDate(localDayKey(new Date(last))) })
    : t("backup.never");
  const panel = el("section.home-panel.home-panel--backup", {}, [
    el("div.home-panel__label", {}, [
      el("span", {}, t("backup.title")),
      el("button.linkbtn", { type: "button", onclick: () => { store.dismissBackupNudge(); panel.remove(); } }, t("backup.dismiss")),
    ]),
    el("p.note", { style: { margin: "2px 0 10px" } }, `${t("backup.body")} ${when}`),
    el("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } }, [
      el("button.btn.btn--sm", {
        type: "button",
        onclick: () => {
          downloadText(`pluggera-backup-${localDayKey()}.json`, store.exportJSON());
          store.markBackedUp();
          toast(t("backup.done"));
          panel.remove();
        },
      }, [icon(ICONS.download, 15), t("backup.now")]),
      el("a.btn.btn--ghost.btn--sm", { href: "#/login" }, t("backup.signIn")),
    ]),
  ]);
  return panel;
}

/** "Gillar du PluggEra?" — asks a signed-in student with real history for a review (#/rate). Only
 *  once they've finished a few sessions, never if they already wrote one, and a dismissal keeps it
 *  away for 60 days on this device. Whether they have a review is asked once per page load (the
 *  home page re-renders on every store change); the panel starts hidden and shows once that's known. */
const REVIEW_PROMPT_KEY = "studify.reviewPromptDismissedAt";
const REVIEW_PROMPT_MIN_ATTEMPTS = 5;
let ownReview = null;   // null = not asked yet, then a promise of true/false
store.addEventListener("deviceCleared", () => { ownReview = null; query = ""; });

function reviewPanel() {
  if (!store.authed || (store.state.attempts || []).length < REVIEW_PROMPT_MIN_ATTEMPTS) return null;
  let dismissedAt = 0;
  try { dismissedAt = Number(localStorage.getItem(REVIEW_PROMPT_KEY)) || 0; } catch {}
  if (Date.now() - dismissedAt < 60 * 86400000) return null;

  ownReview ??= fetch(MY_REVIEW_URL, { credentials: "include" })
    .then((r) => (r.ok ? r.json() : { review: true }))   // unsure = don't nag
    .then((d) => !!d?.review)
    .catch(() => true);

  const panel = el("section.home-panel", { hidden: true }, [
    el("div.home-panel__label", {}, [
      el("span", {}, t("rate.promptTitle")),
      el("button.linkbtn", {
        type: "button",
        onclick: () => { try { localStorage.setItem(REVIEW_PROMPT_KEY, String(Date.now())); } catch {} panel.remove(); },
      }, t("backup.dismiss")),
    ]),
    el("p.note", { style: { margin: "2px 0 10px" } }, t("rate.promptBody")),
    el("a.btn.btn--sm", { href: "#/rate" }, [icon(ICONS.pencil, 15), t("rate.promptCta")]),
  ]);
  ownReview.then((has) => { if (!has) panel.hidden = false; });
  return panel;
}

function calendarPanel() {
  // forceCalendar: the week strip stays put even with nothing due, so the
  // rail doesn't jump in and out of existence as deadlines come and go —
  // and an empty day is still a tap target for adding one.
  const content = deadlineRailContent({ collapsible: true, forceCalendar: true });
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
  return el("section.home-panel.home-panel--ach", {}, [
    el("div.home-panel__label", {}, [
      el("span", {}, t("prog.achievements")),
      el("a.linkbtn", { href: "#/achievements" }, t("ach.subtitle", { unlocked, total: ACHIEVEMENTS.length })),
    ]),
    achNext(),
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
        href: a.href, role: "menuitem",
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


/**
 * A calendar (a dot on every day with a deadline) above the "Upcoming" list,
 * soonest-first. The home rail shows a single collapsed week, expandable to
 * the full month.
 * Returns null when nothing is due.
 */
const UPCOMING_COLLAPSED = 3;
let upcomingExpanded = false;
let calendarExpanded = false;

let pastExpanded = false;

function deadlineRailContent({ collapsible = false, forceCalendar = false } = {}) {
  // Each test once (it stands for its sets) and each set with a deadline of its own, soonest first;
  // every entry knows where a tap goes: a test to its Inför provet page, a set to practising it.
  const all = store.calendarEntries();
  if (!all.length && !forceCalendar) return null;
  const today = localDayKey();
  // What has passed (kept for a week, see the store's sweep) waits behind its own toggle instead of
  // crowding the top of the list for days. A reminder clicked away (its ×) leaves the list and the card
  // but keeps its dot on the calendar: the deadline itself still stands.
  const items = all.filter((x) => x.dueAt >= today && !store.isDueDismissed(x));
  const past = all.filter((x) => x.dueAt < today).reverse();

  // The next deadline still ahead, a test or a set: a countdown + shortcut under the calendar,
  // whichever week or month the calendar is paged to.
  const nextDeadline = items[0];

  // day key -> { ids, titles, items } for the calendar dots + the day chooser (past days too).
  const marks = new Map();
  for (const a of all) {
    const m = marks.get(a.dueAt) || { ids: [], titles: [], items: [] };
    m.ids.push(a.key); m.titles.push(a.title); m.items.push(a);
    marks.set(a.dueAt, m);
  }

  const onPick = (_day, mark, cellEl) => {
    if (mark.items.length === 1) { location.hash = mark.items[0].href; return; }
    openDayChooser(cellEl, mark);
  };

  // Tap an empty future day → name a set for that deadline.
  const onAdd = (day) => openQuickAdd(day);

  // Only the home-rail copy collapses to a single, navigable week — the
  // "Kommande" dialog is an explicit "show me everything" action, so it
  // always gets the full month with no toggle, and its list is never
  // filtered down to whatever's currently paged in.
  const calWrap = el("div.cal-collapse");
  // When the viewed week is empty, just say so: what *is* coming next, with its countdown, is the
  // card under the calendar (nextDeadlineLine), so this line doesn't repeat it.
  const calEmpty = collapsible ? el("p.note.cal-empty", {}, t("menu.calendarEmptyWeek")) : null;
  const calToggle = collapsible ? el("button.linkbtn.cal-collapse__toggle", { type: "button" }) : null;
  if (calToggle) calToggle.addEventListener("click", () => { calendarExpanded = !calendarExpanded; paintCal(); });

  const list = el("div.upcoming__list");
  const more = el("button.upcoming__more", { type: "button" });
  more.addEventListener("click", () => { upcomingExpanded = !upcomingExpanded; paintList(visibleItems); });

  // The rail's list always mirrors whichever week/month the calendar is
  // currently showing; the dialog's onView never fires, so it keeps the
  // full sorted list.
  // Passed deadlines, behind "Passerade (n)". Like the list above, the rail's copy only holds the ones
  // inside whichever week or month the calendar is paged to — a deadline from last Tuesday belongs to
  // last week, and paging to a week with none leaves the block out entirely. The dialog (no onView, so
  // pastRange stays null) keeps every passed one. Open/closed is remembered while the app is open.
  // Declared before the first paintCal(), whose onView call paints it.
  let pastRange = null;   // [start, end] day keys of what the calendar shows
  const pastList = el("div.upcoming__list.upcoming__list--past", { id: "upcoming-past" });
  const pastToggle = el("button.upcoming__more.upcoming__pasttoggle", { type: "button", "aria-controls": "upcoming-past" });
  const pastBlock = el("div.upcoming__past", { hidden: true }, [pastToggle, pastList]);
  pastToggle.addEventListener("click", () => { pastExpanded = !pastExpanded; paintPast(); });
  function paintPast() {
    const shown = pastRange ? past.filter((a) => a.dueAt >= pastRange[0] && a.dueAt <= pastRange[1]) : past;
    pastBlock.hidden = !shown.length;
    pastToggle.textContent = pastExpanded ? t("menu.upcomingPastHide") : t("menu.upcomingPast", { n: shown.length });
    pastToggle.setAttribute("aria-expanded", String(pastExpanded));
    pastList.hidden = !pastExpanded;
    pastList.replaceChildren(...(pastExpanded ? shown.map(row) : []));
  }

  // Shown only while its deadline isn't already a row in the list below (paintList), so the same
  // deadline never sits there twice.
  const nextLine = nextDeadlineLine(nextDeadline);

  let visibleItems = items;
  paintCal();
  paintPast();   // the dialog's only paint; the rail's was already done by the calendar's onView
  if (!collapsible) paintList(visibleItems);

  // Nothing ahead but the calendar is still shown: just the calendar + a hint, no "next deadline"
  // line or list (passed ones keep their toggle).
  const emptyForced = forceCalendar && !items.length;

  return {
    el: el("section.upcoming", {}, [
      calEmpty,
      calWrap,
      nextLine,
      emptyForced ? null : list,
      emptyForced ? null : more,
      pastBlock,
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
    pastRange = [start, end];
    paintPast();
  }

  function onMonthView(start, end) {
    visibleItems = items.filter((a) => a.dueAt >= start && a.dueAt <= end);
    paintList(visibleItems);
    pastRange = [start, end];
    paintPast();
  }

  function paintList(shownItems) {
    const overflow = shownItems.length - UPCOMING_COLLAPSED;
    const shown = overflow > 0 && !upcomingExpanded ? shownItems.slice(0, UPCOMING_COLLAPSED) : shownItems;
    list.replaceChildren(...shown.map(row));
    if (nextLine) nextLine.hidden = shown.includes(nextDeadline);
    more.hidden = overflow <= 0;
    if (overflow > 0) {
      more.textContent = upcomingExpanded ? t("menu.upcomingLess") : t("menu.upcomingAll", { n: shownItems.length });
      more.setAttribute("aria-expanded", String(upcomingExpanded));
    }
  }

  function row(a) {
    const left = daysUntil(a.dueAt);
    const passed = left < 0;
    const soon = left >= 0 && left <= 1;
    const test = a.kind === "test";
    const color = store.subjectColor(a.subjectId);
    const link = el("a", {
      href: a.href,
      class: "upcoming__row" + (passed ? " is-past" : soon ? " is-soon" : "") + (test ? " is-test" : ""),
      style: { "--subject": color.solid },
      "aria-label": t(test ? "menu.upcomingTestAria" : "menu.upcomingStudyAria", { title: a.title }),
    }, [
      el("span.upcoming__dot"),
      el("span.upcoming__main", {}, [
        el("strong", {}, a.title),
        el("span.upcoming__meta", {}, [
          test ? el("span.upcoming__tag", {}, t("common.test")) : null,
          // A test that has been is "3 days ago"; a set past its deadline is late.
          el("span", {}, [`${fmtDate(a.dueAt)} · `,
            el("span.upcoming__when", {}, test && passed ? plural(-left, "date.agoOne", "date.agoMany") : relativeDay(a.dueAt))]),
        ].filter(Boolean)),
      ]),
      passed ? el("span.upcoming__go", {}, icon(test ? ICONS.graduation : ICONS.play, 14)) : null,
    ]);
    // One still ahead can be clicked away; a passed one leaves on its own after a week.
    return passed ? link : el("div.upcoming__item", {}, [link, dismissReminderBtn(a)]);
  }
}

/** The × that clicks a deadline's reminder away from Kommande. Its calendar dot stays (the deadline
 *  still stands), and the toast offers a moment to undo. */
function dismissReminderBtn(a) {
  return el("button.upcoming__x", {
    type: "button", title: t("menu.reminderDismissTitle"),
    "aria-label": t("menu.reminderDismiss", { title: a.title }),
    onclick: (e) => {
      e.preventDefault();
      e.stopPropagation();
      const box = e.currentTarget.parentElement;
      const go = () => {
        store.dismissDue(a);
        toast(t("menu.reminderHidden"), { actionLabel: t("common.undo"), onAction: () => store.undismissDue(a) });
      };
      if (matchMedia("(prefers-reduced-motion: reduce)").matches || !box.animate) { go(); return; }
      box.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(24px)" }],
        { duration: 160, easing: "ease-in", fill: "forwards" }).finished.then(go, go);
    },
  }, icon(ICONS.close, 14));
}

/** Countdown + one-tap shortcut to the next deadline still ahead, sat under the calendar: a test
 *  opens its Inför provet page, a set starts practising it. Null when nothing is ahead. */
function nextDeadlineLine(a) {
  if (!a) return null;
  const d = daysUntil(a.dueAt);
  const soon = d <= 1;
  const test = a.kind === "test";
  return el("div.next-test-wrap", {}, [
    el("a.next-test" + (soon ? ".next-test--soon" : ""), {
      href: a.href,
      "aria-label": t(test ? "menu.upcomingTestAria" : "menu.upcomingStudyAria", { title: a.title }),
    }, [
      el("span.next-test__when", {}, [icon(test ? ICONS.graduation : ICONS.clock, 14), el("span", {}, countdownLabel(a.dueAt))]),
      el("span.next-test__title", {}, a.title),
    ]),
    dismissReminderBtn(a),
  ]);
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
  const hello = t(h < 12 ? "menu.morning" : h < 18 ? "menu.afternoon" : "menu.evening");
  const name = store.profile?.name;   // from the welcome quiz — see components/onboarding.js
  return name ? `${hello}, ${name}` : hello;
}

/** The one thing to do next, first on the home page of a phone (CSS keeps it to phones): a run left
 *  part-way, else the questions due for review, else the set studied last. Nothing on a first visit. */
function continueCard() {
  let run = null;
  for (const a of store.assignments) {
    const r = resumeFor(a);
    if (r && (!run || (r.session.savedAt || 0) > (run.r.session.savedAt || 0))) run = { a, r };
  }
  let kind, a = null, href, title, meta, pct = null;
  if (run) {
    ({ a } = run);
    kind = "resume"; href = run.r.hash; title = a.title;
    meta = t("menu.answeredOf", { n: run.r.answered, total: a.questions.length });
    pct = Math.min(100, Math.round((run.r.answered / Math.max(1, a.questions.length)) * 100));
  } else {
    const due = store.isQuiet() ? 0 : store.dueQuestions().length;
    if (due) {
      kind = "due"; href = "#/review"; title = plural(due, "menu.contDueOne", "menu.contDueMany");
      meta = t("menu.contDueSub");
    } else {
      const last = [...store.attempts].sort((x, y) => (y.finishedAt || 0) - (x.finishedAt || 0))
        .find((x) => store.getAssignment(x.assignmentId));
      if (!last) return null;
      a = store.getAssignment(last.assignmentId);
      kind = "again"; href = `#/session/${a.id}`; title = a.title;
      meta = t("menu.contLastScore", { pct: last.scorePct ?? 0 });
    }
  }
  const color = a ? store.subjectColor(a.subjectId) : null;
  const subject = a ? store.subjects.find((s) => s.id === a.subjectId)?.name : null;
  const eyebrow = { resume: "menu.contResume", due: "menu.contDue", again: "menu.contAgain" }[kind];
  const cta = { resume: "session.continue", due: "menu.contReview", again: "exam.planStart" }[kind];
  return el("a.home-continue.home-continue--" + kind, {
    href, style: color ? { "--subject": color.solid, "--subject-ink": color.ink } : {},
  }, [
    el("span.home-continue__eyebrow", {}, [icon(kind === "due" ? ICONS.layers : ICONS.play, 13), t(eyebrow)]),
    el("strong.home-continue__title", {}, title),
    el("span.home-continue__meta", {}, subject ? `${subject} · ${meta}` : meta),
    pct != null ? el("span.home-continue__bar", { "aria-hidden": "true" }, [el("i", { style: { width: `${Math.max(4, pct)}%` } })]) : null,
    el("span.btn.home-continue__cta", {}, [t(cta), icon(ICONS.arrow, 16)]),
  ].filter(Boolean));
}

/** A small sun by day, a moon at night, beside the greeting. */
function daymark() {
  const part = daypart();
  return el("span.home__daymark", { "aria-hidden": "true", "data-daypart": part },
    icon(part === "evening" || part === "night" ? ICONS.moon : ICONS.sun, 14));
}

/** The top of the home page: the greeting, small, over one question. */
function homeHead() {
  return el("div.home__head", {}, [
    el("div.home__title", {}, [
      el("p.home__date", {}, [daymark(), el("span", {}, greeting())]),
      el("h1", {}, t("menu.askToday")),
    ]),
  ]);
}

/** "Vad vill du plugga idag?" — the big shortcuts to the app's main jobs, each
 *  an icon, a name and one line on what it's for. Same pages as the sidebar;
 *  this is just the obvious place to start from. */
// Bright, slightly neon hues — each tile's edge, glow and icon chip.
const HOME_TILES = [
  { href: "#/create",    icon: ICONS.plus,       label: "nav.create",   sub: "menu.pickCreateSub",  color: "#7650FF" },
  { href: "#/library",   icon: ICONS.book,       label: "nav.library",  sub: "menu.pickLibrarySub", color: "#0FA3C2" },
  { href: "#/exam-prep", icon: ICONS.graduation, label: "nav.examPrep", sub: "menu.pickExamSub",    color: "#22A35A" },
  { href: "#/solve",     icon: ICONS.spark,      label: "nav.solve",    sub: "menu.pickAiSub",      color: "#EE3D86" },
  { href: "#/hp",        icon: ICONS.award,      label: "nav.hp",       sub: "menu.pickHpSub",      color: "#FF7426" },
];
function homeTiles() {
  return el("nav.home-tiles", { "aria-label": t("menu.askToday") }, HOME_TILES.map((x) =>
    el("a.home-tile", { href: x.href, style: { "--tile": x.color } }, [
      el("span.home-tile__ic", { "aria-hidden": "true" }, icon(x.icon, 20)),
      el("span", {}, [el("b", {}, t(x.label)), el("small", {}, t(x.sub))]),
    ])));
}

/** For a brand-new student with no sets yet: one clear action plus a real
 *  starter set to open. Rendered as the first block of the main column
 *  (inside home-layout) rather than full-width above it — full-width would
 *  push the whole two-column grid down while leaving the rail's side empty,
 *  so Kommande/Utmärkelser end up floating with a big gap above them. */
function homeStarter() {
  if (store.assignments.length) return null;
  const needsSignIn = store.aiNeedsSignIn();

  const suggestSlot = el("div", { hidden: true });
  fillStarterSuggestion(suggestSlot);

  return el("div.home__starter", {}, [
    el("div.home__cta", {}, [
      el("a.btn", { href: "#/library" }, [icon(ICONS.book, 18), t("menu.headPickSet")]),
      needsSignIn && el("a.btn.btn--ghost", { href: "#/login" }, t("login.signIn")),
    ].filter(Boolean)),
    suggestSlot,
  ]);
}

/** One real set from the practice library for a student with nothing added
 *  yet: the first set of the first subject at åk 9 (or the first level if
 *  that's missing). One tap adds it and starts it. Stays hidden if the
 *  library index can't load. */
async function fillStarterSuggestion(slot) {
  let index, tr;
  try {
    index = await loadLibraryIndex();
    tr = getLang() === "en" ? await loadLibraryTranslations() : { levels: {}, subjects: {}, sets: {} };
  } catch { return; }

  // The welcome quiz's level and first subject, when they match the library;
  // åk 9 otherwise.
  const wantLevel = { ak7: "ak7", ak8: "ak8", ak9: "ak9", gy: "gymnasiet" }[store.profile?.level];
  const level = index.levels?.find((l) => l.id === wantLevel) || index.levels?.find((l) => l.id === "ak9") || index.levels?.[0];
  const wanted = (store.profile?.subjects || []).map((n) => baseSubjectName(n).toLowerCase());
  const subject = level && (index.subjects?.find((s) => s.level === level.id && wanted.includes(baseSubjectName(tr.subjects?.[s.id]?.name || s.name).toLowerCase()))
    || index.subjects?.find((s) => s.level === level.id));
  const entry = subject && index.sets?.find((s) => s.subject === subject.id);
  if (!entry) return;

  const levelLabel = tr.levels?.[level.id] || level.label;
  const subjectName = tr.subjects?.[subject.id]?.name || subject.name;
  const setTitle = tr.sets?.[entry.id]?.title || entry.title;

  const card = el("button.home-suggest", {
    type: "button",
    onclick: async () => {
      card.disabled = true;
      try {
        await importSet(entry);
        location.hash = `#/session/${entry.id}`;
      } catch {
        toast(t("lib.addFail"));
        card.disabled = false;
      }
    },
  }, [
    el("span.home-suggest__ic", {}, icon(ICONS.book, 20)),
    el("span.home-suggest__body", {}, [
      el("span.home-suggest__eyebrow", {}, t("menu.suggestLabel")),
      el("span.home-suggest__title", {}, setTitle),
      el("span.home-suggest__meta", {}, [
        levelLabel, subjectName, plural(entry.count, "common.questionOne", "common.questionMany"),
      ].join(" · ")),
    ]),
    icon(ICONS.arrow, 16),
  ]);
  slot.appendChild(card);
  slot.hidden = false;
}

// The test card's × hides it for the rest of the day, on this device: like the house ad's, a nicety and
// not study data, so it stays out of the synced state. Tomorrow, or another test, brings the card back.
const TEST_CARD_KEY = "studybuddy.testCardHidden";
function testCardHidden(id) {
  try { const v = JSON.parse(localStorage.getItem(TEST_CARD_KEY) || "null"); return v?.id === id && v?.day === localDayKey(); }
  catch { return false; }
}
function setTestCardHidden(id) {
  try {
    if (id) localStorage.setItem(TEST_CARD_KEY, JSON.stringify({ id, day: localDayKey() }));
    else localStorage.removeItem(TEST_CARD_KEY);
  } catch { /* private mode: it just won't stay hidden */ }
}

/** The next test, first thing on the home screen: how far off it is and today's task for it. */
function nextTestCard() {
  const exam = upcomingExams(store.exams, store.assignments, localDayKey())[0];
  if (!exam || exam.days > 21 || !exam.sets.length || testCardHidden(exam.id)) return null;
  const m = prepFor(exam);
  const subject = store.subjects.find((s) => s.id === exam.subjectId);
  const title = exam.title || t("exam.cardTitle", { subject: subject?.name || "" });
  const open = m.todayStudy.find((x) => !x.done)?.task || null;
  const hideBtn = el("button.exam-card__x", {
    type: "button", title: t("menu.testCardHideTitle"), "aria-label": t("menu.testCardHide", { title }),
    onclick: () => {
      const parent = card.parentNode, next = card.nextSibling;
      const gone = () => {
        setTestCardHidden(exam.id);
        card.remove();
        toast(t("menu.testCardHidden"), {
          actionLabel: t("common.undo"),
          onAction: () => { setTestCardHidden(null); card.getAnimations().forEach((a) => a.cancel()); parent?.insertBefore(card, next); },
        });
      };
      if (matchMedia("(prefers-reduced-motion: reduce)").matches || !card.animate) { gone(); return; }
      card.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-6px)" }],
        { duration: 160, easing: "ease-in", fill: "forwards" }).finished.then(gone, gone);
    },
  }, icon(ICONS.close, 15));
  const card = el("article.exam-card.home-exam", { style: { "--subject": store.subjectColor(exam.subjectId).solid } }, [
    el("div.exam-card__top", {}, [
      el("a.exam-card__name", { href: `#/exam-prep/${exam.id}` }, [el("span.exam-dot"), title]),
      el("div.exam-card__end", {}, [
        el("span.exam-pill" + (exam.days <= 2 ? ".is-soon" : ""), {}, shortCountdown(exam.days)),
        hideBtn,
      ]),
    ]),
    el("div.exam-card__today", {}, m.allDoneToday
      ? [el("span.exam-card__done", {}, [icon(ICONS.check, 15), t("exam.doneLabel")]),
          el("a.btn.btn--ghost.btn--sm", { href: `#/exam-prep/${exam.id}` }, t("nav.examPrep"))]
      : open
        ? [
            el("span.exam-card__task", {}, [el("b", {}, `${t("exam.planToday")}: `), taskLabel(open, subject?.name || "")]),
            el("a.btn.btn--sm", { href: taskHash(open, m) }, [
              taskButtonLabel(open),
              icon(ICONS.arrow, 14),
            ]),
          ]
        : [el("a.btn.btn--ghost.btn--sm", { href: `#/exam-prep/${exam.id}` }, t("nav.examPrep"))]),
  ]);
  return card;
}

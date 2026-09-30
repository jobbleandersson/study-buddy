// Home menu: a "today" strip, an "upcoming" deadline list, Assignments | Tests
// tabs, filters, and the card grid.

import { store } from "../store.js";
import { el, clear, icon, ICONS, toast, downloadText } from "../lib/dom.js";
import { t, plural, fmtDate, relativeDay, daysUntil, getLang } from "../lib/i18n.js";
import { importSet } from "../data/library.js";
import { loadLibraryIndex, loadLibraryTranslations, baseSubjectName } from "../lib/library-content.js";
import { localDayKey } from "../lib/activity.js";
import { weeklyRecap, isoWeek } from "../lib/recap.js";
import { masteryByTopic, masteryForAssignment } from "../lib/mastery.js";
import { monthCalendar, weekStrip } from "../components/calendar.js";
import { confirmDialog } from "../components/confirm-dialog.js";
import { homeButton } from "../components/nav.js";
import { openDueDialog, closeDueDialog } from "../components/due-dialog.js";
import { openQuickAdd, closeQuickAdd } from "../components/quick-add.js";
import { ACHIEVEMENTS, nextAchievement } from "../lib/achievements.js";
import { countdownLabel } from "../lib/date-phrases.js";
import { testsTomorrow } from "../lib/tonight.js";
import { dailySlot } from "../components/daily-card.js";
import { houseAd } from "../components/house-ad.js";
import { tonightPlan } from "./tonight.js";
import { shareSet } from "../lib/share-set.js";
import { nearlyThere } from "../lib/near.js";
import { openTalk } from "../components/talk-player.js";
import { loadScript, scriptKey } from "../lib/podcast.js";
import { MY_REVIEW_URL } from "../config.js";

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
    if (store.assignments.length) grid.appendChild(newCard());   // first run: the empty state below already offers it
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
        isFirstRun && store.demoStatus.loaded === 0 && el("button.btn.btn--ghost", {
          type: "button",
          onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try { await store.loadDemoContent(); toast(t("menu.demoAdded")); }
            catch { toast(t("menu.demoFailed")); btn.disabled = false; }
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
      (store.canUseAI() || loadScript(scriptKey(a))) && (a.questions?.length || 0) > 0 && item(ICONS.headphones, t("menu.itemTalk"), () => openTalk(a)),
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
  const menuCleanup = () => { closeCardMenu(); closeDueDialog(); closeDayChooser(); closeQuickAdd(); };

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

  // The dedicated #/calendar page lives in js/views/calendar.js now — a full
  // month planner with the deadlines drawn in and an agenda rail — so it's no
  // longer a mode of renderMenu(). deadlineRailContent() below still powers
  // the home rail's collapsed week and the "Kommande" dialog.

  // "Dina set" — one panel holding everything about browsing the library:
  // tabs, search, the Filter drawer, and the card grid.
  const setsPanel = el("section.home-panel.home-panel--sets", {}, [
    el("div.home-panel__label", {}, [el("span", {}, t("menu.panelSets"))]),
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
    el("div.home-main", {}, [greetingBlock, tonightCard(), dailySlot(), homeTiles(), homeStarter(), nearPanel(), ad, setsPanel].filter(Boolean)),
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

/** The right-hand rail on the home page: the weekly recap (until dismissed),
 *  backup and review nudges when due, an always-present mini calendar +
 *  Upcoming list, and an achievements teaser (the badge closest to
 *  unlocking, or a "you got them all" note). */
function homeRail() {
  const panels = [recapCard(), backupPanel(), reviewPanel(), calendarPanel(), achievementsPanel()].filter(Boolean);
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

/** "Nästan där": the sets you got close on but never finished at 100 %, closest first. Each row shows
 *  the best score as a strip of ten dots and links straight into the set. Null when there are none. */
function nearPanel() {
  const { items, total } = nearlyThere(store.assignments, store.attempts);
  if (!items.length) return null;
  const rows = items.map(({ assignment: a, best, attempts }) => {
    const pct = Math.round(best);
    return el("a.near__row", { href: `#/session/${a.id}`, "aria-label": t("menu.nearAria", { title: a.title, best: pct }) }, [
      el("span.near__txt", {}, [
        el("b", {}, a.title),
        el("small", {}, [t("menu.nearBest", { best: pct }), plural(attempts, "menu.nearTriesOne", "menu.nearTriesMany", { n: attempts })].join(" · ")),
        el("span.near__bar", { "aria-hidden": "true" }, [el("i", { style: { width: `${pct}%` } })]),
      ]),
      el("span.near__go", {}, [t("menu.nearGo"), icon(ICONS.arrow, 14)]),
    ]);
  });
  return el("section.home-panel.home-panel--near", {}, [
    el("div.home-panel__label", {}, [
      el("span", {}, t("menu.nearTitle")),
      el("small.near__sub", {}, plural(total, "menu.nearSubOne", "menu.nearSubMany", { n: total })),
    ]),
    el("div.near__list", {}, rows),
  ]);
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

function deadlineRailContent({ collapsible = false, forceCalendar = false } = {}) {
  const items = store.upcomingDue();
  if (!items.length && !forceCalendar) return null;

  // items is soonest-first, so items[0] is the next deadline due — a test or a
  // plain assignment. Shown as a countdown + study shortcut under the calendar,
  // independent of which week/month the calendar is currently paged to. (It
  // used to require a "test"-type set, so a library-first student — whose sets
  // are all "assignment" — got no countdown at all.)
  const nextDeadline = items[0];

  // day key -> { ids, titles, items } for the calendar dots + the day chooser.
  const marks = new Map();
  for (const a of items) {
    const m = marks.get(a.dueAt) || { ids: [], titles: [], items: [] };
    m.ids.push(a.id); m.titles.push(a.title); m.items.push(a);
    marks.set(a.dueAt, m);
  }

  const onPick = (_day, mark, cellEl) => {
    if (mark.items.length === 1) { location.hash = `#/session/${mark.items[0].id}`; return; }
    openDayChooser(cellEl, mark);
  };

  // Tap an empty future day → name a set for that deadline.
  const onAdd = (day) => openQuickAdd(day);

  // Only the home-rail copy collapses to a single, navigable week — the
  // "Kommande" dialog is an explicit "show me everything" action, so it
  // always gets the full month with no toggle, and its list is never
  // filtered down to whatever's currently paged in.
  const calWrap = el("div.cal-collapse");
  // When the viewed week is empty, point at what *is* coming rather than just
  // saying "nothing" — the deadline the student cares about is often a week or
  // two out, exactly when this used to read as a flat dead end.
  const calEmpty = collapsible
    ? el("p.note.cal-empty", {}, items.length
        ? t("menu.calendarEmptyWeekNext", { when: countdownLabel(items[0].dueAt) })
        : t("menu.calendarEmptyWeek"))
    : null;
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
  // just the month + a hint, no "next deadline" line or list.
  const emptyForced = forceCalendar && !items.length;

  return {
    el: el("section.upcoming", {}, [
      calEmpty,
      calWrap,
      emptyForced ? null : nextDeadlineLine(nextDeadline),
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

/** Countdown + one-tap shortcut to the soonest deadline, sat under the
 *  calendar, with a small "Prep" link through to its exam-prep page.
 *  Days elsewhere, but hours once it's due today. Null when nothing has a
 *  due date. */
function nextDeadlineLine(a) {
  if (!a) return null;
  const d = daysUntil(a.dueAt);
  const soon = d <= 1;
  const card = el("a.next-test" + (soon ? ".next-test--soon" : ""), {
    href: `#/session/${a.id}`,
    "aria-label": t("menu.upcomingStudyAria", { title: a.title }),
  }, [
    el("span.next-test__when", {}, [icon(ICONS.clock, 14), el("span", {}, countdownLabel(a.dueAt))]),
    el("span.next-test__title", {}, a.title),
    el("span.next-test__go", {}, icon(ICONS.play, 14)),
  ]);
  return el("div.next-test-wrap", {}, [
    card,
    a.subjectId ? el("a.next-test__prep", {
      href: `#/exam-prep/${a.subjectId}`,
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
  const hello = t(h < 12 ? "menu.morning" : h < 18 ? "menu.afternoon" : "menu.evening");
  const name = store.profile?.name;   // from the welcome quiz — see components/onboarding.js
  return name ? `${hello}, ${name}` : hello;
}

/** The top of the home page: the greeting, small, over one question. */
function homeHead() {
  return el("div.home__head", {}, [
    el("div.home__title", {}, [
      el("p.home__date", {}, greeting()),
      el("h1", {}, t("menu.askToday")),
    ]),
  ]);
}

/** "Vad vill du plugga idag?" — the big shortcuts to the app's main jobs, each
 *  an icon, a name and one line on what it's for. Same pages as the sidebar;
 *  this is just the obvious place to start from. */
const HOME_TILES = [
  { href: "#/create",    icon: ICONS.plus,       label: "nav.create",   sub: "menu.pickCreateSub",  color: "#7A5CFF" },
  { href: "#/library",   icon: ICONS.book,       label: "nav.library",  sub: "menu.pickLibrarySub", color: "#1F9FB5" },
  { href: "#/exam-prep", icon: ICONS.graduation, label: "nav.examPrep", sub: "menu.pickExamSub",    color: "#4C9F55" },
  { href: "#/solve",     icon: ICONS.spark,      label: "nav.solve",    sub: "menu.pickAiSub",      color: "#E4588A" },
  { href: "#/hp",        icon: ICONS.award,      label: "nav.hp",       sub: "menu.pickHpSub",      color: "#F0913C" },
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

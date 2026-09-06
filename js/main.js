// Router + persistent app shell.

import { store } from "./store.js";
import { el, clear, mount, append, icon, ICONS, toast, showBanner, hideBanner, downloadText } from "./lib/dom.js";
import { announce, focusHeading } from "./lib/a11y.js";
import { t, plural, getLang, setLang, applyLang, LANGS, daysUntil } from "./lib/i18n.js";
import { localDayKey } from "./lib/activity.js";
import { THEMES, getTheme, setTheme } from "./lib/theme.js";
import { openPopover, closePopover } from "./lib/popover.js";
import { showAchievementUnlocks } from "./lib/achievement-toast.js";
import { renderMenu } from "./views/menu.js";
import { renderCreate } from "./views/create.js";
import { renderEdit } from "./views/edit.js";
import { renderSession, renderReview, renderPractice, renderWeakPractice, renderNationalMix, isSessionActive } from "./views/session.js";
import { renderResults } from "./views/results.js";
import { renderProgress } from "./views/progress.js";
import { renderSettings } from "./views/settings.js";
import { renderLogin } from "./views/login.js";
import { renderParentHub, renderParentStudent } from "./views/parent-dashboard.js";
import { renderGallery } from "./views/gallery.js";
import { renderPrint } from "./views/print.js";
import { renderTeachback } from "./views/teachback.js";
import { renderLibrary } from "./views/library.js";
import { renderExamPrep } from "./views/exam-prep.js";
import { renderSolve } from "./views/solve.js";
import { renderAchievements } from "./views/achievements.js";
import { mountCommandPalette } from "./components/command-palette.js";
import { maybeShowOnboarding } from "./components/onboarding.js";

const app = document.getElementById("app");

const routes = [
  { rx: /^\/?$/, view: () => renderMenu() },
  { rx: /^\/study$/, view: () => renderMenu("study") },
  { rx: /^\/calendar$/, view: () => renderMenu("calendar") },
  { rx: /^\/create$/, view: (m, qs) => renderCreate(qs) },
  { rx: /^\/edit\/(.+)$/, view: (m, qs) => renderEdit(m[1], qs) },
  { rx: /^\/review$/, view: () => renderReview() },
  { rx: /^\/practice-weak$/, view: (m, qs) => renderWeakPractice(qs) },
  { rx: /^\/practice\/(.+)$/, view: (m) => renderPractice(m[1]) },
  { rx: /^\/exam-prep(?:\/(.+))?$/, view: (m, qs) => renderExamPrep(m[1] || null, qs) },
  { rx: /^\/session\/(.+)$/, view: (m, qs) => renderSession(m[1], qs) },
  { rx: /^\/results\/(.+)$/, view: (m) => renderResults(m[1]) },
  { rx: /^\/progress$/, view: () => renderProgress() },
  { rx: /^\/settings$/, view: () => renderSettings() },
  { rx: /^\/gallery$/, view: () => renderGallery() },
  { rx: /^\/library$/, view: () => renderLibrary() },
  { rx: /^\/solve$/, view: () => renderSolve() },
  { rx: /^\/achievements$/, view: () => renderAchievements() },
  { rx: /^\/print\/(.+)$/, view: (m) => renderPrint(m[1]) },
  { rx: /^\/teachback\/(.+)$/, view: (m) => renderTeachback(m[1]) },
  { rx: /^\/login$/, view: () => renderLogin() },
  { rx: /^\/parent$/, view: () => renderParentHub() },
  { rx: /^\/parent\/(.+)$/, view: (m) => renderParentStudent(m[1]) },
  { rx: /^\/national\/mix\/(.+)$/, view: (m, qs) => renderNationalMix(m[1], qs) },
];

let currentCleanup = null;
let currentViewNode = null;
let firstPaintDone = false;

function parseHash() {
  const full = location.hash.replace(/^#/, "");
  const [path, qs] = full.split("?");
  const params = new URLSearchParams(qs || "");
  for (const r of routes) {
    const m = path.match(r.rx);
    if (m) return () => r.view(m, params);
  }
  return () => renderMenu();
}

/** Cycles through the supported languages — with two, it's a straight toggle. */
function nextLang() {
  const codes = LANGS.map(([c]) => c);
  return codes[(codes.indexOf(getLang()) + 1) % codes.length];
}

/** The full app nav, grouped so the sidebar reads as sections rather than one
 *  long list — "Learn" (make + study material), "Track" (see how it's going),
 *  and an unlabelled account group at the bottom. Used by the desktop sidebar
 *  and the mobile ⋮ menu alike, so the two never drift. */
function navGroups() {
  const learn = [
    { href: "#/",         match: "/",          icon: ICONS.home,      label: t("nav.home") },
    { href: "#/study",    match: "/study",     icon: ICONS.clipboard, label: t("nav.study") },
    { href: "#/library",  match: "/library",   icon: ICONS.book,      label: t("nav.library") },
    { href: "#/create",   match: "/create",    icon: ICONS.plus,      label: t("nav.create") },
    { href: "#/solve",    match: "/solve",     icon: ICONS.spark,     label: t("nav.solve") },
    { href: "#/exam-prep", match: "/exam-prep", icon: ICONS.graduation, label: t("nav.examPrep") },
  ];
  const track = [
    { href: "#/calendar", match: "/calendar",  icon: ICONS.calendar,  label: t("nav.calendar") },
    { href: "#/progress", match: "/progress",  icon: ICONS.chart,     label: t("common.progress") },
    { href: "#/achievements", match: "/achievements", icon: ICONS.award, label: t("nav.achievements") },
  ];
  const account = [];
  if (store.authed) account.push({ href: "#/parent", match: "/parent", icon: ICONS.users, label: t("common.parent") });
  account.push({ href: "#/settings", match: "/settings", icon: ICONS.gear, label: t("common.settings") });

  return [
    { key: "learn",   label: t("nav.groupLearn"), items: learn },
    { key: "track",   label: t("nav.groupTrack"), items: track },
    { key: "account", label: null,                items: account },
  ];
}

/** Flat list — still used where a single sequence is all that's needed. */
function navItems() {
  return navGroups().flatMap((g) => g.items);
}

function currentPath() {
  return "/" + location.hash.replace(/^#\/?/, "").split("?")[0];
}
function navActive(match) {
  const p = currentPath();
  return match === "/" ? p === "/" : p.startsWith(match);
}

/** The narrow-screen ⋮ menu — the same nav as the desktop sidebar.
 *  Closes on outside click, Esc, or navigation. */
function topOverflowMenu() {
  const list = el("div.topmenu__list", { role: "menu", hidden: true },
    navGroups().flatMap((g, gi) => [
      g.label
        ? el("p.topmenu__group", { role: "presentation" }, g.label)
        : gi > 0 ? el("div.topmenu__div", { role: "presentation" }) : null,
      ...g.items.map((it) => el("a.topmenu__item" + (navActive(it.match) ? ".is-active" : ""), {
        href: it.href, role: "menuitem",
        "aria-current": navActive(it.match) ? "page" : null,
      }, [icon(it.icon, 16), it.label])),
    ].filter(Boolean)));

  const btn = el("button.iconbtn", {
    type: "button", "aria-haspopup": "menu", "aria-expanded": "false",
    "aria-label": t("common.menu"), title: t("common.menu"),
  }, [icon(ICONS.dots, 18)]);

  function close() {
    list.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onDoc, true);
    document.removeEventListener("keydown", onEsc, true);
  }
  function onDoc(e) { if (!wrap.contains(e.target)) close(); }
  function onEsc(e) { if (e.key === "Escape") close(); }

  btn.addEventListener("click", () => {
    if (list.hidden) {
      list.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      setTimeout(() => {
        document.addEventListener("click", onDoc, true);
        document.addEventListener("keydown", onEsc, true);
      }, 0);
    } else close();
  });
  list.addEventListener("click", (e) => { if (e.target.closest("a")) close(); });

  const wrap = el("div.topmenu", {}, [btn, list]);
  return wrap;
}

function langButton() {
  const current = getLang();
  const next = nextLang();
  const flagSvg = LANGS.find(([c]) => c === current)?.[2] || "";
  const nextLabel = LANGS.find(([c]) => c === next)?.[1] || next;
  return el("button.iconbtn.langbtn", {
    type: "button",
    "aria-label": `${t("common.language")} → ${nextLabel}`,
    title: `${t("common.language")} → ${nextLabel}`,
    onclick: () => { setLang(next); toast(t("set.langUpdated")); },
  }, [el("span.langbtn__flag", { "aria-hidden": "true", html: flagSvg }), el("span.langbtn__code", {}, current.toUpperCase())]);
}

function streakBadge(streak, atRisk) {
  if (!(streak > 0)) return null;
  return el("a.streakbadge" + (atRisk ? ".streakbadge--risk" : ""), {
    href: "#/progress",
    "aria-label": t("prog.streakAria", { n: streak }),
    title: atRisk ? t("streak.atRiskShort")
      : streak === 1 ? t("menu.tileStreakOne", { n: streak }) : t("menu.tileStreak", { n: streak }),
  }, [icon(atRisk ? ICONS.shield : ICONS.flame, 14), el("span.tabular", {}, String(streak))]);
}

/** The sidebar footer's fuller streak row — same streak/at-risk logic as the
 *  compact topbar badge, just spelled out (icon + the day count in words)
 *  instead of a bare number. Sidebar-only, so the topbar's compact badge is
 *  untouched. Always shown, muted at zero — a fixed spot in the footer
 *  rather than something that pops in once a streak starts. */
function sidebarStreak(streak, atRisk) {
  const none = !(streak > 0);
  return el("a.sidebar__streak" + (atRisk ? ".sidebar__streak--risk" : none ? ".sidebar__streak--none" : ""), {
    href: "#/progress",
    "aria-label": t("prog.streakAria", { n: streak }),
  }, [
    el("span.sidebar__streak-icon", {}, icon(atRisk ? ICONS.shield : ICONS.flame, 18)),
    atRisk ? t("streak.atRiskShort")
      : streak === 1 ? t("menu.tileStreakOne", { n: streak }) : t("menu.tileStreak", { n: streak }),
  ]);
}

const THEME_ICONS = { system: ICONS.monitor, light: ICONS.sun, dark: ICONS.moon };
// Light / system / dark, left to right — independent of THEMES' own order
// (which Settings' dropdown uses instead), just this widget's layout.
const THEME_ORDER = ["light", "system", "dark"];

/** Segmented light/system/dark switcher for the sidebar footer. Self-painting
 *  so a click doesn't have to re-render the whole shell just to update itself.
 *  Also listens for a theme change made elsewhere (the Settings dropdown,
 *  while staying on that page) — a full render() would work too, but flashes
 *  the loading state for what's really just an instant CSS swap. The listener
 *  unhooks itself once this instance's node is no longer on the page, so
 *  navigating away (which replaces the whole sidebar) doesn't pile up stale
 *  listeners. */
function themePicker() {
  const wrap = el("div.sidebar__theme", { role: "group", "aria-label": t("set.theme") });

  function paint() {
    clear(wrap);
    const current = getTheme();
    for (const value of THEME_ORDER) {
      const label = t(`set.theme${value[0].toUpperCase()}${value.slice(1)}`);
      wrap.appendChild(el("button.sidebar__theme-btn", {
        type: "button",
        "aria-pressed": String(value === current),
        "aria-label": label, title: label,
        onclick: () => setTheme(value),
      }, icon(THEME_ICONS[value], 15)));
    }
  }
  // Only the event-triggered path needs the disconnect check — the initial
  // call below runs before the caller has mounted `wrap` at all.
  function onExternalChange() {
    if (!wrap.isConnected) { window.removeEventListener("sb:themechange", onExternalChange); return; }
    paint();
  }
  window.addEventListener("sb:themechange", onExternalChange);
  paint();
  return wrap;
}

/** Two-flag segmented switcher for the sidebar footer — direct-select
 *  (each flag its own button) rather than the single cycling button used
 *  in the topbar (langButton(), left unchanged — no room here for both
 *  flags at that size). No self-sync listener needed: setLang() already
 *  dispatches "sb:langchange", which main.js's top-level listener answers
 *  with a full render() — that rebuilds this picker fresh with the new
 *  current language already reflected, unlike the theme picker which
 *  deliberately avoids a full render to skip the loading-state flash. */
function sidebarLangPicker() {
  const current = getLang();
  return el("div.sidebar__lang", { role: "group", "aria-label": t("common.language") },
    LANGS.map(([code, label, flagSvg]) => el("button.sidebar__lang-btn", {
      type: "button",
      "aria-pressed": String(code === current),
      "aria-label": label, title: label,
      onclick: () => setLang(code),
    }, [el("span", { "aria-hidden": "true", html: flagSvg })])));
}

const DAY_MS = 86400000;

/** The two live notification types, each with a stable id and a "signature"
 *  snapshotting the fact that fired it (a due count, or a test id + date +
 *  day-count). store.isNotificationRead() compares against that signature,
 *  not just the id — so a notification you dismissed reads as unread again
 *  once the underlying fact changes (more questions pile up, the test gets a
 *  day closer) instead of staying silently dismissed forever. */
function buildNotifications() {
  const now = Date.now();
  const list = [];

  const due = store.dueQuestions();
  if (due.length) {
    const oldestDueAt = Math.min(...due.map((d) => d.rec?.dueAt ?? now));
    const daysSince = Math.max(0, Math.floor((now - oldestDueAt) / DAY_MS));
    const signature = String(due.length);
    list.push({
      id: "due-review",
      icon: ICONS.spark,
      title: plural(due.length, "notif.dueReviewOne", "notif.dueReviewMany"),
      body: t("notif.dueReviewBody"),
      meta: daysSince <= 0 ? t("notif.dueSinceToday")
        : plural(daysSince, "notif.dueSinceDayOne", "notif.dueSinceDayMany"),
      href: "#/review",
      linkLabel: t("notif.reviewNow"),
      signature,
      read: store.isNotificationRead("due-review", signature),
    });
  }

  const test = store.upcomingDue().find((a) => a.type === "test" && a.dueAt);
  if (test) {
    const d = daysUntil(test.dueAt);
    if (d >= 0 && d <= 7) {
      const signature = `${test.id}|${test.dueAt}|${d}`;
      list.push({
        id: "exam-reminder",
        icon: ICONS.graduation,
        title: d === 0 ? t("notif.examToday") : d === 1 ? t("notif.examTomorrow") : t("notif.examInDays", { n: d }),
        body: t("notif.examBody"),
        meta: test.title,
        href: test.subjectId ? `#/exam-prep/${test.subjectId}` : `#/session/${test.id}`,
        linkLabel: t("notif.viewExam"),
        signature,
        read: store.isNotificationRead("exam-reminder", signature),
      });
    }
  }

  return list;
}

function popoverLink(href, path, label) {
  return el("a.cardmenu__item", { href, onclick: closePopover }, [icon(path, 15), label]);
}

// Kept module-level so the last tab picked survives closing and reopening the
// panel within a visit.
let notifTab = "unread";

function openNotificationPanel(anchor) {
  const tabUnreadBtn = el("button.notiftab", { type: "button", role: "tab", onclick: (e) => { e.stopPropagation(); notifTab = "unread"; paint(); } });
  const tabReadBtn = el("button.notiftab", { type: "button", role: "tab", onclick: (e) => { e.stopPropagation(); notifTab = "read"; paint(); } });
  const bodyEl = el("div.notifpanel__body");

  function refreshBellDot() {
    const stillUnread = buildNotifications().some((n) => !n.read);
    const dot = anchor.querySelector(".topbar__dot");
    if (stillUnread && !dot) anchor.appendChild(el("span.topbar__dot"));
    else if (!stillUnread && dot) dot.remove();
  }

  function card(n) {
    return el("div.notifcard" + (n.read ? "" : ".notifcard--unread"), {}, [
      el("div.notifcard__icon", {}, [icon(n.icon, 18)]),
      el("div.notifcard__main", {}, [
        el("p.notifcard__title", {}, n.title),
        el("p.notifcard__text", {}, n.body),
        el("div.notifcard__footer", {}, [
          el("a.notifcard__link", { href: n.href, onclick: closePopover }, n.linkLabel),
          el("span.notifcard__meta", {}, n.meta),
        ]),
      ]),
      !n.read ? el("button.notifcard__mark", {
        type: "button", "aria-label": t("notif.markRead"), title: t("notif.markRead"),
        onclick: (e) => { e.stopPropagation(); store.markNotificationRead(n.id, n.signature); paint(); },
      }, [icon(ICONS.check, 14)]) : null,
    ].filter(Boolean));
  }

  function paint() {
    const all = buildNotifications();
    const unread = all.filter((n) => !n.read);
    const read = all.filter((n) => n.read);

    clear(tabUnreadBtn);
    append(tabUnreadBtn, unread.length
      ? [t("notif.tabUnread"), el("span.notiftab__count", {}, String(unread.length))]
      : t("notif.tabUnread"));
    tabUnreadBtn.setAttribute("aria-selected", String(notifTab === "unread"));

    clear(tabReadBtn);
    append(tabReadBtn, t("notif.tabRead"));
    tabReadBtn.setAttribute("aria-selected", String(notifTab === "read"));

    const listNodes = notifTab === "unread" ? unread : read;
    clear(bodyEl);
    if (!listNodes.length) {
      bodyEl.appendChild(el("p.note", { style: { padding: "var(--s-5) var(--s-3)", textAlign: "center" } },
        notifTab === "unread" ? t("notif.none") : t("notif.noneRead")));
    } else {
      for (const n of listNodes) bodyEl.appendChild(card(n));
    }
    refreshBellDot();
  }

  openPopover(anchor, [
    el("div.notifpanel__head", {}, [
      el("h3", {}, t("notif.panelTitle")),
      el("button.iconbtn.iconbtn--sm", { type: "button", "aria-label": t("common.close"), onclick: closePopover }, [icon(ICONS.close, 16)]),
    ]),
    el("div.notiftabs", { role: "tablist" }, [tabUnreadBtn, tabReadBtn]),
    bodyEl,
  ], { align: "right", width: 360, role: "dialog", label: t("notif.panelTitle") });

  paint();
}

/** Notification bell + account button — top-right on mobile's topbar, and in
 *  the desktop sidebar's header row. Notifications are real signals already in
 *  the store; no fake badge count. */
function shellActions() {
  const hasUnread = buildNotifications().some((n) => !n.read);

  const bellBtn = el("button.iconbtn.topbar__bell", {
    type: "button", "aria-label": t("topbar.notifications"), "aria-haspopup": "dialog", title: t("topbar.notifications"),
    onclick: (e) => { e.stopPropagation(); openNotificationPanel(e.currentTarget); },
  }, [icon(ICONS.bell, 18), hasUnread ? el("span.topbar__dot") : null].filter(Boolean));

  const profileBtn = el("button.iconbtn.topbar__profile", {
    type: "button", "aria-label": t("topbar.account"), "aria-haspopup": "menu", title: t("topbar.account"),
    onclick: (e) => {
      e.stopPropagation();
      const items = store.authed ? [
        el("p.note", { style: { padding: "var(--s-2) var(--s-3)" } }, t("account.signedInAs", { email: store.authEmail || "" })),
        popoverLink("#/settings", ICONS.gear, t("account.settings")),
        el("button.cardmenu__item.cardmenu__item--danger", {
          type: "button",
          onclick: async () => { closePopover(); try { await store.logout(); } catch {} toast(t("account.signOutDone")); },
        }, [icon(ICONS.logout, 15), t("account.signOut")]),
      ] : [
        popoverLink("#/login", ICONS.user, t("account.signIn")),
        popoverLink("#/settings", ICONS.gear, t("account.settings")),
      ];
      openPopover(e.currentTarget, items, { align: "right" });
    },
  }, [icon(ICONS.user, 18)]);

  return el("div.topbar__actions", {}, [bellBtn, profileBtn]);
}

function shell(contentNode) {
  const { displayStreak: streak, atRisk } = store.streakInfo;

  // Desktop: a left sidebar carries the whole nav; the topbar stays but
  // collapses (via CSS) to just the bell + account pair on the right.
  // Mobile: the full topbar shows, and its ⋮ mirrors the sidebar nav.
  const sidebar = el("nav.sidebar", { "aria-label": t("common.menu") }, [
    el("a.sidebar__brand", { href: "#/" }, [
      el("img", { src: "assets/favicon.svg", alt: "" }), "StudyBuddy",
    ]),
    el("div.sidebar__nav", {}, navGroups().flatMap((g, gi) => [
      g.label
        ? el("p.sidebar__group", {}, g.label)
        : gi > 0 ? el("div.sidebar__div") : null,
      ...g.items.map((it) =>
        el("a.sidebar__link" + (navActive(it.match) ? ".is-active" : ""), {
          href: it.href, "aria-current": navActive(it.match) ? "page" : null,
        }, [icon(it.icon, 18), it.label])),
    ].filter(Boolean))),
    el("div.sidebar__foot", {}, [
      sidebarStreak(streak, atRisk),
      themePicker(),
      sidebarLangPicker(),
    ].filter(Boolean)),
  ]);

  return el("div.shell", {}, [
    sidebar,
    el("div.shell__main", {}, [
      el("header.topbar", {}, [
        el("div.topbar__inner", {}, [
          el("a.brand", { href: "#/" }, [
            el("img", { src: "assets/favicon.svg", alt: "" }), "StudyBuddy",
          ]),
          el("span.topbar__spacer"),
          streakBadge(streak, atRisk),
          langButton(),
          shellActions(),
          topOverflowMenu(),
        ]),
      ]),
      el("main.content", { id: "main" }, [contentNode]),
    ]),
  ]);
}

async function render({ chromeOnly = false } = {}) {
  // chromeOnly: re-run the shell (nav labels, sidebar) around the view that's
  // already mounted, without rebuilding the view itself. Used on a language
  // switch while a session is running — the session refreshes its own
  // content in place (see its "sb:langsession" listener) so a full re-render
  // would needlessly wipe the tutor thread and bounce the scroll.
  if (chromeOnly) {
    if (currentViewNode) mount(app, shell(currentViewNode));
    return;
  }

  closePopover();
  if (typeof currentCleanup === "function") { try { currentCleanup(); } catch {} }
  currentCleanup = null;

  const viewFn = parseHash();
  mount(app, shell(el("div", {
    style: { padding: "40px", textAlign: "center", color: "var(--ink-faint)" },
  }, t("common.loading"))));

  try {
    const result = await viewFn();
    const node = result?.node || result;
    currentCleanup = result?.cleanup || null;
    currentViewNode = node;
    mount(app, shell(node));

    const title = result?.title || "StudyBuddy";
    document.title = result?.title ? `${result.title} · StudyBuddy` : "StudyBuddy";
    window.scrollTo(0, 0);

    // Deliberate focus + a single short announcement, rather than a live
    // region that re-reads the entire page on every navigation.
    if (firstPaintDone) {
      focusHeading(app.querySelector(".content"));
      announce(title);
    }
    firstPaintDone = true;
  } catch (e) {
    console.error(e);
    mount(app, shell(el("div.empty", {}, [
      el("h2", {}, t("common.somethingWrong")),
      el("p", {}, String(e?.message || e)),
      el("a.btn.btn--ghost", { href: "#/", style: { marginTop: "16px" } }, t("common.backToMenu")),
    ])));
    announce(t("common.somethingWrongShort"));
  }
}

window.addEventListener("hashchange", () => render());
// A language switch: demo and library set content follows the UI language, so
// re-translate it in the store *first* — then one refresh lands everything in
// the new language. A running session refreshes its question + tutor in place
// (so the switch doesn't interrupt the set); every other screen re-renders.
window.addEventListener("sb:langchange", async () => {
  applyLang();
  // Best-effort — a failed content sync must not leave the UI stranded in the
  // old language, so the re-render below always runs.
  try {
    await Promise.all([store.syncDemoLanguage(), store.syncLibraryLanguage()]);
  } catch (e) {
    console.warn("language content sync failed:", e);
  }
  if (isSessionActive()) {
    window.dispatchEvent(new Event("sb:langsession"));
    render({ chromeOnly: true });
  } else {
    render();
  }
});

// Offline support + home-screen install. Only over http(s) — a service worker
// can't register from file://, and failing to register is not fatal.
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((e) => {
      console.warn("Service worker not registered:", e.message);
    });
  });
}

mountCommandPalette();

store.init().then(() => {
  applyLang();
  render();
  maybeShowOnboarding();
  // Bring any demo or library sets loaded in a different language up to date —
  // then refresh whatever's on screen so a deep-linked session or the home
  // grid shows the corrected wording.
  Promise.all([store.syncDemoLanguage(), store.syncLibraryLanguage()]).then((counts) => {
    if (!counts.some(Boolean)) return;
    if (isSessionActive()) { window.dispatchEvent(new Event("sb:langsession")); render({ chromeOnly: true }); }
    else render();
  });
  // After first paint, keep menu/progress fresh when the store changes.
  store.addEventListener("change", () => {
    const h = location.hash.replace(/^#/, "");
    if (h === "" || h === "/" || h === "/study" || h === "/calendar" || h === "/progress" || h === "/achievements") render();
  });
  store.addEventListener("syncConflict", () => {
    toast(t("sync.conflict"));
  });
  store.addEventListener("streakFreezeUsed", (e) => {
    toast(t("streak.freezeUsedToast", { n: e.detail.streak }));
  });
  store.addEventListener("achievements", (e) => {
    showAchievementUnlocks(e.detail);
  });
  store.addEventListener("saveFailed", () => {
    showBanner(t("save.failedBanner"), {
      actionLabel: t("save.emergencyExport"),
      closeLabel: t("common.close"),
      onAction: () => {
        downloadText(`studybuddy-backup-${localDayKey()}.json`, store.exportJSON());
        toast(t("set.backupDownloaded"));
      },
    });
  });
  store.addEventListener("saveRecovered", hideBanner);
}).catch((e) => {
  console.error("Boot failed:", e);
  bootFailure(e);
});

/** Last resort: the app failed to start. Deliberately independent of `store`
 *  and shell() — the thing that just broke — so it reads localStorage
 *  directly rather than through the Store class, which may never have
 *  finished constructing correctly. */
function bootFailure(err) {
  let raw = null;
  try { raw = localStorage.getItem("studybuddy.v1"); } catch {}

  mount(app, el("div.empty", {}, [
    el("h2", {}, t("boot.failedTitle")),
    el("p", {}, t("boot.failedBody")),
    el("p.note", {}, String(err?.message || err)),
    el("div", { style: { display: "flex", gap: "10px", justifyContent: "center", marginTop: "16px", flexWrap: "wrap" } }, [
      el("button.btn", { type: "button", onclick: () => location.reload() }, t("boot.reload")),
      raw ? el("button.btn.btn--ghost", {
        type: "button",
        onclick: () => downloadText(`studybuddy-emergency-${new Date().toISOString().slice(0, 10)}.json`, raw),
      }, t("boot.downloadData")) : null,
    ].filter(Boolean)),
  ]));
}

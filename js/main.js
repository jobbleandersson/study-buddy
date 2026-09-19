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
import { renderSession, renderReview, renderPractice, renderWeakPractice, renderNationalMix, renderHpMock, isSessionActive } from "./views/session.js";
import { renderResults } from "./views/results.js";
import { renderProgress } from "./views/progress.js";
import { renderSettings } from "./views/settings.js";
import { renderLogin } from "./views/login.js";
import { renderParentHub, renderParentStudent } from "./views/parent-dashboard.js";
import { renderGallery } from "./views/gallery.js";
import { renderPrint } from "./views/print.js";
import { renderTeachback } from "./views/teachback.js";
import { renderLibrary } from "./views/library.js";
import { renderCalendarPage } from "./views/calendar.js";
import { renderExamPrep } from "./views/exam-prep.js";
import { renderHp } from "./views/hp.js";
import { renderSolve } from "./views/solve.js";
import { renderReference } from "./views/reference.js";
import { renderCalculator } from "./views/calculator.js";
import { renderAchievements } from "./views/achievements.js";
import { renderLeaderboard } from "./views/leaderboard.js";
import { renderAbout, renderTerms, renderPrivacy } from "./views/legal.js";
import { renderLanding } from "./views/landing.js";
import { mountCommandPalette } from "./components/command-palette.js";
import { mountSiteChat } from "./components/site-chat.js";
import { mountUpgradePrompt } from "./components/upgrade-prompt.js";
import { renderChallenge } from "./views/challenge.js";
import { maybeShowOnboarding } from "./components/onboarding.js";

const app = document.getElementById("app");

/**
 * Should the root route show the front page instead of the app? Only for a
 * genuinely new visitor: no sets of their own, intro not seen, not signed in,
 * and not an installed-PWA launch (an app someone added to their home screen
 * should open the app, not a pitch for it). Deep links are honoured elsewhere
 * — this only ever governs the root route.
 */
function shouldShowLanding() {
  if (store.state.onboarded) return false;
  if (store.assignments.length) return false;
  if (store.authed) return false;
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) return false;
    if (window.navigator.standalone) return false;   // iOS home-screen launch
  } catch { /* matchMedia unavailable — fall through and show it */ }
  return true;
}

const routes = [
  // Root is the front page for a first-time visitor and the app for everyone
  // else, decided at render time rather than by redirecting — no flash, and
  // the URL a newcomer was given stays the URL they're looking at.
  { rx: /^\/?$/, view: () => (shouldShowLanding() ? renderLanding() : renderMenu()) },
  { rx: /^\/study$/, view: () => renderMenu("study") },
  { rx: /^\/calendar$/, view: () => renderCalendarPage() },
  { rx: /^\/create$/, view: (m, qs) => renderCreate(qs) },
  { rx: /^\/edit\/(.+)$/, view: (m, qs) => renderEdit(m[1], qs) },
  { rx: /^\/review$/, view: () => renderReview() },
  { rx: /^\/practice-weak$/, view: (m, qs) => renderWeakPractice(qs) },
  { rx: /^\/practice\/(.+)$/, view: (m) => renderPractice(m[1]) },
  { rx: /^\/exam-prep(?:\/(.*))?$/, view: (m, qs) => renderExamPrep(m[1] || null, qs) },
  { rx: /^\/hp$/, view: () => renderHp() },
  { rx: /^\/hp\/mock$/, view: (m, qs) => renderHpMock(qs) },
  { rx: /^\/session\/(.+)$/, view: (m, qs) => renderSession(m[1], qs) },
  { rx: /^\/results\/(.+)$/, view: (m) => renderResults(m[1]) },
  { rx: /^\/progress$/, view: () => renderProgress() },
  { rx: /^\/settings$/, view: () => renderSettings() },
  { rx: /^\/gallery$/, view: () => renderGallery() },
  { rx: /^\/library$/, view: () => renderLibrary() },
  { rx: /^\/utmaning$/, view: (m, qs) => renderChallenge(qs) },
  { rx: /^\/solve$/, view: () => renderSolve() },
  { rx: /^\/reference$/, view: () => renderReference() },
  { rx: /^\/calculator$/, view: () => renderCalculator() },
  { rx: /^\/achievements$/, view: () => renderAchievements() },
  { rx: /^\/leaderboard$/, view: () => renderLeaderboard() },
  { rx: /^\/print\/(.+)$/, view: (m, qs) => renderPrint(m[1], qs) },
  { rx: /^\/teachback\/(.+)$/, view: (m) => renderTeachback(m[1]) },
  { rx: /^\/login$/, view: () => renderLogin() },
  { rx: /^\/parent$/, view: () => renderParentHub() },
  { rx: /^\/parent\/(.+)$/, view: (m) => renderParentStudent(m[1]) },
  { rx: /^\/national\/mix\/(.+)$/, view: (m, qs) => renderNationalMix(m[1], qs) },
  { rx: /^\/welcome$/, view: () => renderLanding() },
  { rx: /^\/about$/, view: () => renderAbout() },
  { rx: /^\/terms$/, view: () => renderTerms() },
  { rx: /^\/privacy$/, view: () => renderPrivacy() },
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
    { href: "#/hp",       match: "/hp",        icon: ICONS.award,     label: t("nav.hp") },
  ];
  // Leaderboard isn't in the nav — it has its own round icon in the topbar,
  // on every screen (see shellActions).
  const track = [
    { href: "#/calendar", match: "/calendar",  icon: ICONS.calendar,  label: t("nav.calendar") },
    { href: "#/progress", match: "/progress",  icon: ICONS.chart,     label: t("common.progress") },
    { href: "#/achievements", match: "/achievements", icon: ICONS.award, label: t("nav.achievements") },
  ];
  const tools = [
    { href: "#/reference",  match: "/reference",  icon: ICONS.sigma,      label: t("nav.formulas") },
    { href: "#/calculator", match: "/calculator", icon: ICONS.calculator, label: t("nav.calculator") },
  ];
  const account = [];
  if (store.authed) account.push({ href: "#/parent", match: "/parent", icon: ICONS.users, label: t("common.parent") });
  account.push({ href: "#/settings", match: "/settings", icon: ICONS.gear, label: t("common.settings") });

  return [
    { key: "learn",   label: t("nav.groupLearn"), items: learn },
    { key: "track",   label: t("nav.groupTrack"), items: track },
    { key: "tools",   label: t("nav.groupTools"), items: tools },
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

/** The narrow-screen "Meny" tab — the same nav as the desktop sidebar, opened
 *  from the bottom tab bar (see tabBar()) rather than a topbar icon, so the
 *  app's full navigation isn't the least distinguishable of several look-alike
 *  circular buttons. Closes on outside click, Esc, or navigation. `active`
 *  marks the tab itself current — the current page lives inside this menu
 *  rather than one of the bar's own three direct tabs. */
function moreMenu(active) {
  const list = el("div.topmenu__list", { role: "menu", hidden: true }, [
    ...navGroups().flatMap((g, gi) => [
      g.label
        ? el("p.topmenu__group", { role: "presentation" }, g.label)
        : gi > 0 ? el("div.topmenu__div", { role: "presentation" }) : null,
      ...g.items.map((it) => el("a.topmenu__item" + (navActive(it.match) ? ".is-active" : ""), {
        href: it.href, role: "menuitem",
        "aria-current": navActive(it.match) ? "page" : null,
      }, [icon(it.icon, 16), it.label])),
    ].filter(Boolean)),
    // The sidebar's theme switcher has no home on mobile (no sidebar) — so it
    // lives here, in the menu, rather than only in Settings. Language keeps
    // its own topbar button; the streak shows in the topbar badge and the
    // "Idag" panel — so this footer is theme only.
    el("div.topmenu__div", { role: "presentation" }),
    el("div.topmenu__foot", { role: "presentation" }, [
      el("p.topmenu__group", { role: "presentation" }, t("set.theme")),
      themePicker(),
    ]),
  ]);

  const btn = el("button.tabbar__item" + (active ? ".is-active" : ""), {
    type: "button", "aria-haspopup": "menu", "aria-expanded": "false",
    "aria-label": t("common.menu"),
  }, [icon(ICONS.dots, 20), el("span", {}, t("common.menu"))]);

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

  const wrap = el("div.tabbar__more", {}, [btn, list]);
  return wrap;
}

/** Fixed bottom tab bar — mobile's primary nav, hidden on desktop (the sidebar
 *  covers this there). Three direct destinations plus "Meny" for everything
 *  else, instead of every screen living behind one unlabeled icon among
 *  several look-alikes in the topbar. */
function tabBar() {
  const tabs = [
    { href: "#/", match: "/", icon: ICONS.home, label: t("nav.home") },
    { href: "#/study", match: "/study", icon: ICONS.clipboard, label: t("nav.study") },
    { href: "#/create", match: "/create", icon: ICONS.plus, label: t("nav.create") },
  ];
  const anyTabActive = tabs.some((tb) => navActive(tb.match));
  return el("nav.tabbar", { "aria-label": t("common.menu") }, [
    ...tabs.map((tb) => el("a.tabbar__item" + (navActive(tb.match) ? ".is-active" : ""), {
      href: tb.href, "aria-current": navActive(tb.match) ? "page" : null,
    }, [icon(tb.icon, 20), el("span", {}, tb.label)])),
    moreMenu(!anyTabActive),
  ]);
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

const THEME_ICONS = { system: ICONS.monitor, light: ICONS.sun, paper: ICONS.fileText, dark: ICONS.moon };
// Light / warm paper / system / dark, left to right — independent of THEMES'
// own order, just this widget's layout.
const THEME_ORDER = ["light", "paper", "system", "dark"];

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

  // Högskoleprovet — the date is a setting, not a set, so it needs its own line.
  const hpDate = store.settings.hpDate;
  if (hpDate) {
    const d = daysUntil(hpDate);
    if (d >= 0 && d <= 7) {
      const signature = `hp|${hpDate}|${d}`;
      list.push({
        id: "hp-reminder",
        icon: ICONS.award,
        title: d === 0 ? t("hp.notifToday") : d === 1 ? t("hp.notifTomorrow") : t("hp.notifInDays", { n: d }),
        body: t("hp.notifBody"),
        meta: t("hp.pageTitle"),
        href: "#/hp",
        linkLabel: t("hp.notifLink"),
        signature,
        read: store.isNotificationRead("hp-reminder", signature),
      });
    }
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

  // Leaderboard — a round icon beside the bell, on every screen (it's not in
  // the nav). Signed out it opens a sign-in prompt.
  const leaderboardBtn = el("a.iconbtn.topbar__leaderboard" + (navActive("/leaderboard") ? ".is-active" : ""), {
    href: "#/leaderboard", "aria-label": t("nav.leaderboard"), title: t("nav.leaderboard"),
  }, [icon(ICONS.podium, 18)]);

  return el("div.topbar__actions", {}, [leaderboardBtn, bellBtn, profileBtn]);
}

/** Full-screen focus routes — a running session, a printable worksheet — where
 *  the persistent bottom nav is a distraction and would sit under the
 *  session's own floating hint button. The homeButton() at the top of each of
 *  those views is the way out. */
function immersiveRoute() {
  return /^\/(session|review|practice|practice-weak|print|teachback)(\/|$)/.test(currentPath())
    || currentPath() === "/hp/mock";
}

// Highlighter-swipe wordmark: two rough, overlapping tinted strokes behind
// the brand text, like it's been marked up twice with a highlighter.
function wordmark(text) {
  return [
    el("span.wordmark__bar.wordmark__bar--1", { "aria-hidden": "true" }),
    el("span.wordmark__bar.wordmark__bar--2", { "aria-hidden": "true" }),
    el("span.wordmark__text", {}, text),
  ];
}

function shell(contentNode) {
  const { displayStreak: streak, atRisk } = store.streakInfo;
  const immersive = immersiveRoute();

  // Desktop: a left sidebar carries the whole nav; the topbar stays but
  // collapses (via CSS) to just the bell + account pair on the right.
  // Mobile: the full topbar shows, and its ⋮ mirrors the sidebar nav.
  const sidebar = el("nav.sidebar", { "aria-label": t("common.menu") }, [
    el("a.sidebar__brand", { href: "#/" }, [
      el("img", { src: "assets/favicon.svg", alt: "" }),
      el("span.wordmark", {}, wordmark("Studify")),
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
    ].filter(Boolean)),
  ]);

  return el("div.shell" + (immersive ? ".shell--immersive" : ""), {}, [
    sidebar,
    el("div.shell__main", {}, [
      el("header.topbar", {}, [
        el("div.topbar__inner", {}, [
          el("a.brand", { href: "#/", "aria-label": t("nav.home") }, [
            el("img", { src: "assets/favicon.svg", alt: "" }),
            el("span.brand__name.wordmark", {}, wordmark("Studify")),
          ]),
          el("span.topbar__spacer"),
          streakBadge(streak, atRisk),
          langButton(),
          shellActions(),
        ]),
      ]),
      // No footer during a running session / worksheet — same focus rule as
      // the tab bar.
      el("main.content", { id: "main" }, [contentNode, immersive ? null : siteFooter()].filter(Boolean)),
      immersive ? null : tabBar(),
    ]),
  ]);
}

/** Sits at the bottom of every page's content, inside .content so it shares
 *  its max-width and mobile tab-bar clearance — the one place About/Terms/
 *  Privacy are reachable from, deliberately not the main nav. */
function siteFooter() {
  return el("footer.sitefooter", {}, [
    el("span.sitefooter__brand", {}, [
      el("img", { src: "assets/favicon.svg", alt: "" }), "Studify",
    ]),
    el("nav.sitefooter__links", { "aria-label": t("footer.nav") }, [
      el("a", { href: "#/about" }, t("footer.about")),
      el("a", { href: "#/terms" }, t("footer.terms")),
      el("a", { href: "#/privacy" }, t("footer.privacy")),
      el("a", { href: "mailto:liamohrn0911@gmail.com" }, t("footer.contact")),
    ]),
    el("span.sitefooter__copy", {}, t("footer.copy")),
  ]);
}

async function render({ chromeOnly = false, softRefresh = false } = {}) {
  // chromeOnly: re-run the shell (nav labels, sidebar) around the view that's
  // already mounted, without rebuilding the view itself. Used on a language
  // switch while a session is running — the session refreshes its own
  // content in place (see its "sb:langsession" listener) so a full re-render
  // would needlessly wipe the tutor thread and bounce the scroll.
  if (chromeOnly) {
    if (currentViewNode) mount(app, shell(currentViewNode));
    return;
  }

  // softRefresh: a re-render triggered by a store change on the *same* screen
  // (a background sync, a goal reached) — not a navigation. Keep the scroll
  // position and don't steal focus or announce.
  const keepY = softRefresh ? window.scrollY : 0;

  closePopover();
  if (typeof currentCleanup === "function") { try { currentCleanup(); } catch {} }
  currentCleanup = null;

  const viewFn = parseHash();
  // On a soft refresh the current screen stays put until the rebuilt one is
  // ready — no loading flash for what's usually an instant rebuild.
  if (!softRefresh) {
    mount(app, shell(el("div", {
      style: { padding: "40px", textAlign: "center", color: "var(--ink-faint)" },
    }, t("common.loading"))));
  }

  try {
    const result = await viewFn();
    const node = result?.node || result;
    currentCleanup = result?.cleanup || null;
    currentViewNode = node;
    // `chrome: false` mounts a view on its own — no sidebar, topbar or tab
    // bar around it. Only the front page uses it: it brings its own header
    // and footer, and app furniture would undercut the point of a front page.
    const bare = result?.chrome === false;
    document.body.classList.toggle("no-chrome", bare);
    mount(app, bare ? node : shell(node));
    // A running session / worksheet is a focus context — hide the floating
    // app-help chat there too (it lives on <body>, outside the shell).
    document.body.classList.toggle("route-immersive", immersiveRoute());

    const title = result?.title || "Studify";
    document.title = result?.title ? `${result.title} · Studify` : "Studify";
    window.scrollTo(0, keepY);

    // Deliberate focus + a single short announcement, rather than a live
    // region that re-reads the entire page on every navigation. A soft refresh
    // isn't a navigation — leave focus and the screen reader alone.
    if (firstPaintDone && !softRefresh) {
      // A bare (chrome-less) view has no .content wrapper — fall back to the
      // mount root so its own <h1> still takes focus on navigation.
      focusHeading(app.querySelector(".content") || app);
      announce(title);
    }
    firstPaintDone = true;
  } catch (e) {
    console.error(e);
    // The error screen is a normal app screen, so the chrome comes back.
    document.body.classList.remove("no-chrome");
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
    await Promise.all([store.syncDemoLanguage(), store.syncLibraryLanguage(), store.syncHpLanguage()]);
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
mountSiteChat();
mountUpgradePrompt();

store.init().then(() => {
  applyLang();
  render();
  // The front page covers the same ground as the first-run modal (better),
  // so only one of the two ever greets a new visitor.
  if (!shouldShowLanding()) maybeShowOnboarding();
  // Bring any demo or library sets loaded in a different language up to date —
  // then refresh whatever's on screen so a deep-linked session or the home
  // grid shows the corrected wording.
  // Language first, then any questions a library moment has gained since the
  // student added it — so an appended question lands in the right language.
  Promise.all([
    store.syncDemoLanguage(),
    store.syncLibraryLanguage().then(async (n) => n + (await store.syncLibraryUpdates())),
    store.syncHpLanguage(),
  ]).then((counts) => {
    if (!counts.some(Boolean)) return;
    if (isSessionActive()) { window.dispatchEvent(new Event("sb:langsession")); render({ chromeOnly: true }); }
    else render();
  });
  // After first paint, keep menu/progress fresh when the store changes.
  store.addEventListener("change", () => {
    const h = location.hash.replace(/^#/, "").split("?")[0];
    if (h === "" || h === "/" || h === "/study" || h === "/calendar" || h === "/progress"
        || h === "/achievements" || h === "/hp" || h === "/exam-prep" || h.startsWith("/exam-prep/")) render({ softRefresh: true });
  });
  store.addEventListener("syncMerged", () => toast(t("sync.merged")));
  store.addEventListener("syncConflict", (e) => {
    if (e.detail?.recoverable && store.syncDiscard) {
      showBanner(t("sync.conflictBanner"), {
        actionLabel: t("sync.downloadReplaced"),
        closeLabel: t("common.close"),
        onAction: () => {
          const d = store.syncDiscard;
          if (d) {
            downloadText(`studify-replaced-${localDayKey()}.json`, JSON.stringify(d.blob, null, 2));
            toast(t("set.backupDownloaded"));
          }
        },
      });
    } else {
      toast(t("sync.conflict"));
    }
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
        downloadText(`studify-backup-${localDayKey()}.json`, store.exportJSON());
        store.markBackedUp();
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
        onclick: () => downloadText(`studify-emergency-${new Date().toISOString().slice(0, 10)}.json`, raw),
      }, t("boot.downloadData")) : null,
    ].filter(Boolean)),
  ]));
}

// Router + persistent app shell.

import { store } from "./store.js";
import { el, mount, icon, ICONS, toast } from "./lib/dom.js";
import { announce, focusHeading } from "./lib/a11y.js";
import { t, getLang, setLang, applyLang, LANGS } from "./lib/i18n.js";
import { renderMenu } from "./views/menu.js";
import { renderCreate } from "./views/create.js";
import { renderEdit } from "./views/edit.js";
import { renderSession, renderReview, renderPractice, renderWeakPractice } from "./views/session.js";
import { renderResults } from "./views/results.js";
import { renderProgress } from "./views/progress.js";
import { renderSettings } from "./views/settings.js";

const app = document.getElementById("app");

const routes = [
  { rx: /^\/?$/, view: () => renderMenu() },
  { rx: /^\/create$/, view: () => renderCreate() },
  { rx: /^\/edit\/(.+)$/, view: (m) => renderEdit(m[1]) },
  { rx: /^\/review$/, view: () => renderReview() },
  { rx: /^\/practice-weak$/, view: () => renderWeakPractice() },
  { rx: /^\/practice\/(.+)$/, view: (m) => renderPractice(m[1]) },
  { rx: /^\/session\/(.+)$/, view: (m) => renderSession(m[1]) },
  { rx: /^\/results\/(.+)$/, view: (m) => renderResults(m[1]) },
  { rx: /^\/progress$/, view: () => renderProgress() },
  { rx: /^\/settings$/, view: () => renderSettings() },
];

let currentCleanup = null;
let firstPaintDone = false;

function parseHash() {
  const h = location.hash.replace(/^#/, "");
  for (const r of routes) {
    const m = h.match(r.rx);
    if (m) return () => r.view(m);
  }
  return () => renderMenu();
}

/** Cycles through the supported languages — with two, it's a straight toggle. */
function nextLang() {
  const codes = LANGS.map(([c]) => c);
  return codes[(codes.indexOf(getLang()) + 1) % codes.length];
}

function shell(contentNode) {
  const streak = store.streak;
  const next = nextLang();
  const nextLabel = LANGS.find(([c]) => c === next)?.[1] || next;

  return el("div", {}, [
    el("header.topbar", {}, [
      el("div.topbar__inner", {}, [
        el("a.brand", { href: "#/" }, [
          el("img", { src: "assets/favicon.svg", alt: "" }),
          "StudyBuddy",
        ]),
        el("span.topbar__spacer"),
        streak > 0 && el("span.streakbadge", {
          "aria-label": t("prog.streakAria", { n: streak }),
          title: streak === 1 ? t("menu.tileStreakOne", { n: streak }) : t("menu.tileStreak", { n: streak }),
        }, [icon(ICONS.flame, 14), el("span.tabular", {}, String(streak))]),
        el("button.iconbtn.langbtn", {
          type: "button",
          "aria-label": `${t("common.language")}: ${nextLabel}`,
          title: `${t("common.language")} → ${nextLabel}`,
          onclick: () => { setLang(next); toast(t("set.langUpdated")); },
        }, [icon(ICONS.globe, 18), el("span.langbtn__code", {}, next.toUpperCase())]),
        el("a.iconbtn", { href: "#/progress", "aria-label": t("common.progress"), title: t("common.progress") }, [icon(ICONS.chart, 18)]),
        el("a.iconbtn", { href: "#/settings", "aria-label": t("common.settings"), title: t("common.settings") }, [icon(ICONS.gear, 18)]),
      ]),
    ]),
    el("main.content", { id: "main" }, [contentNode]),
  ]);
}

async function render() {
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

window.addEventListener("hashchange", render);
// A language switch re-renders exactly like a navigation.
window.addEventListener("sb:langchange", () => { applyLang(); render(); });

// Offline support + home-screen install. Only over http(s) — a service worker
// can't register from file://, and failing to register is not fatal.
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((e) => {
      console.warn("Service worker not registered:", e.message);
    });
  });
}

store.init().then(() => {
  applyLang();
  render();
  // After first paint, keep menu/progress fresh when the store changes.
  store.addEventListener("change", () => {
    const h = location.hash.replace(/^#/, "");
    if (h === "" || h === "/" || h === "/progress") render();
  });
});

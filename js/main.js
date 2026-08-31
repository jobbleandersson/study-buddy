// Router + persistent app shell.

import { store } from "./store.js";
import { el, mount, icon, ICONS } from "./lib/dom.js";
import { announce, focusHeading } from "./lib/a11y.js";
import { renderMenu } from "./views/menu.js";
import { renderCreate } from "./views/create.js";
import { renderEdit } from "./views/edit.js";
import { renderSession, renderReview, renderPractice } from "./views/session.js";
import { renderResults } from "./views/results.js";
import { renderProgress } from "./views/progress.js";
import { renderSettings } from "./views/settings.js";

const app = document.getElementById("app");

const routes = [
  { rx: /^\/?$/, view: () => renderMenu() },
  { rx: /^\/create$/, view: () => renderCreate() },
  { rx: /^\/edit\/(.+)$/, view: (m) => renderEdit(m[1]) },
  { rx: /^\/review$/, view: () => renderReview() },
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

function shell(contentNode) {
  const streak = store.streak;
  return el("div", {}, [
    el("header.topbar", {}, [
      el("div.topbar__inner", {}, [
        el("a.brand", { href: "#/" }, [
          el("img", { src: "assets/favicon.svg", alt: "" }),
          "StudyBuddy",
        ]),
        el("span.topbar__spacer"),
        streak > 0 && el("span.streakbadge", {
          "aria-label": `${streak} day study streak`,
          title: `${streak}-day study streak`,
        }, [icon(ICONS.flame, 14), el("span.tabular", {}, String(streak))]),
        el("a.iconbtn", { href: "#/progress", "aria-label": "Progress", title: "Progress" }, [icon(ICONS.chart, 18)]),
        el("a.iconbtn", { href: "#/settings", "aria-label": "Settings", title: "Settings" }, [icon(ICONS.gear, 18)]),
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
  }, "Loading…")));

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
      el("h2", {}, "Something went wrong"),
      el("p", {}, String(e?.message || e)),
      el("a.btn.btn--ghost", { href: "#/", style: { marginTop: "16px" } }, "Back to menu"),
    ])));
    announce("Something went wrong.");
  }
}

window.addEventListener("hashchange", render);

store.init().then(() => {
  render();
  // After first paint, keep menu/progress fresh when the store changes.
  store.addEventListener("change", () => {
    const h = location.hash.replace(/^#/, "");
    if (h === "" || h === "/" || h === "/progress") render();
  });
});

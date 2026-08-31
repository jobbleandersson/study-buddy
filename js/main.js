// Router + persistent app shell.

import { store } from "./store.js";
import { el, mount, clear, icon, ICONS } from "./lib/dom.js";
import { renderMenu } from "./views/menu.js";
import { renderCreate } from "./views/create.js";
import { renderSession } from "./views/session.js";
import { renderResults } from "./views/results.js";
import { renderProgress } from "./views/progress.js";
import { renderSettings } from "./views/settings.js";

const app = document.getElementById("app");

const routes = [
  { rx: /^\/?$/, view: () => renderMenu() },
  { rx: /^\/create$/, view: () => renderCreate() },
  { rx: /^\/session\/(.+)$/, view: (m) => renderSession(m[1]) },
  { rx: /^\/results\/(.+)$/, view: (m) => renderResults(m[1]) },
  { rx: /^\/progress$/, view: () => renderProgress() },
  { rx: /^\/settings$/, view: () => renderSettings() },
];

let currentCleanup = null;

function parseHash() {
  const h = location.hash.replace(/^#/, "");
  for (const r of routes) {
    const m = h.match(r.rx);
    if (m) return () => r.view(m);
  }
  return () => renderMenu();
}

function shell(contentNode) {
  const streak = store.state.activity.streakCount || 0;
  return el("div", {}, [
    el("header.topbar", {}, [
      el("div.topbar__inner", {}, [
        el("a.brand", { href: "#/" }, [
          el("img", { src: "assets/favicon.svg", alt: "" }),
          "StudyBuddy",
        ]),
        el("span.topbar__spacer"),
        streak > 0 && el("span.chip", { title: `${streak}-day study streak`, style: { "--subject": "var(--retry)" }, "aria-pressed": "true" }, [
          icon(ICONS.flame, 14), `${streak}`,
        ]),
        el("a.iconbtn", { href: "#/progress", "aria-label": "Progress", title: "Progress" }, [icon(ICONS.chart, 18)]),
        el("a.iconbtn", { href: "#/settings", "aria-label": "Settings", title: "Settings" }, [icon(ICONS.gear, 18)]),
      ]),
    ]),
    el("main.content", {}, [contentNode]),
  ]);
}

async function render() {
  if (typeof currentCleanup === "function") { try { currentCleanup(); } catch {} }
  currentCleanup = null;

  const viewFn = parseHash();
  const loading = el("div", { style: { padding: "40px", textAlign: "center", color: "var(--ink-faint)" } }, "Loading…");
  mount(app, shell(loading));

  try {
    const result = await viewFn();
    const node = result?.node || result;
    currentCleanup = result?.cleanup || null;
    mount(app, shell(node));
    document.title = result?.title ? `${result.title} · StudyBuddy` : "StudyBuddy";
    window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    mount(app, shell(el("div.empty", {}, [
      el("h2", {}, "Something went wrong"),
      el("p", {}, String(e?.message || e)),
      el("a.btn.btn--ghost", { href: "#/", style: { marginTop: "16px" } }, "Back to menu"),
    ])));
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

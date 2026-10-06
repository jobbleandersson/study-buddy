// "#/admin/errors" — the anonymous error reports students' browsers send (js/lib/error-report.js), most
// recently seen first. Not linked from anywhere in the app: whoever runs PluggEra opens it directly with
// the same admin key as #/admin/reviews (REVIEW_ADMIN_KEY on the server), kept in sessionStorage for
// this tab only. "Mark as fixed" removes an error; if it happens again it comes back with a fresh count.
// Server side: routes/client-errors.js.

import { el, icon, ICONS, toast, clear } from "../lib/dom.js";
import { t, plural, getLang } from "../lib/i18n.js";
import { homeButton } from "../components/nav.js";
import { ADMIN_ERRORS_URL, adminErrorUrl } from "../config.js";
import { openSiteGate, siteIsLocked } from "../components/site-gate-dialog.js";

// Shared with #/admin/reviews: one key, typed once per tab.
const KEY_STORE = "studify.reviewAdminKey";
const readKey = () => { try { return sessionStorage.getItem(KEY_STORE) || ""; } catch { return ""; } };
const saveKey = (k) => { try { k ? sessionStorage.setItem(KEY_STORE, k) : sessionStorage.removeItem(KEY_STORE); } catch {} };

const when = (ms) => new Date(ms).toLocaleString(getLang() === "sv" ? "sv-SE" : "en-GB", { dateStyle: "medium", timeStyle: "short" });

export function renderAdminErrors() {
  let key = readKey();
  const body = el("div", { style: { display: "grid", gap: "12px" } });

  async function call(method, url) {
    const res = await fetch(url, { method, headers: { "x-admin-key": key } });
    const data = await res.json().catch(() => ({}));
    // The private-site gate answers 403 too: that's "type the site password first", not a wrong key.
    if (data?.error?.code === "site_locked") {
      const err = new Error(t("adminErr.siteLocked"));
      err.siteLocked = true;
      throw err;
    }
    if (res.status === 403 || (res.status === 404 && method === "GET")) {
      const err = new Error(res.status === 403 ? t("adminRev.wrongKey") : t("adminErr.notSetUp"));
      err.auth = true;
      throw err;
    }
    if (!res.ok) throw new Error(data?.error?.message || t("login.somethingWrong"));
    return data;
  }

  function gatePanel() {
    return el("section.panel", {}, [
      el("p.note", { style: { marginBottom: "12px" } }, t("adminErr.siteLocked")),
      el("button.btn", { type: "button", onclick: () => openSiteGate("#/admin/errors") }, t("gate.submit")),
    ]);
  }

  function keyForm(message) {
    const input = el("input", { type: "password", autocomplete: "off", required: true, id: "admin-errors-key" });
    const note = el("p.note.note--warn", { hidden: !message, role: "alert" }, message || "");
    return el("section.panel", {}, [
      el("p.note", { style: { marginBottom: "12px" } }, t("adminErr.keyIntro")),
      el("form", {
        onsubmit: (e) => {
          e.preventDefault();
          key = input.value.trim();
          if (!key) return;
          saveKey(key);
          load();
        },
      }, [
        el("label.field", {}, [el("span", {}, t("adminRev.keyLabel")), input]),
        note,
        el("button.btn", { type: "submit" }, t("adminRev.open")),
      ]),
    ]);
  }

  function errorCard(e) {
    return el("article.panel.admin-error", {}, [
      el("div.admin-error__head", {}, [
        el("span.hp-chip" + (e.kind === "error" ? ".is-wrong" : ""), {}, t(`adminErr.kind.${e.kind}`)),
        el("strong.admin-error__count", {}, plural(e.count, "adminErr.countOne", "adminErr.countMany")),
      ]),
      el("p.admin-error__msg", {}, e.message),
      e.source ? el("p.admin-error__src", {}, e.source) : null,
      el("p.note", {}, t("adminErr.seen", { first: when(e.firstAt), last: when(e.lastAt) })),
      el("p.note", {}, [e.route || "/", e.browser, e.version].filter(Boolean).join(" · ")),
      e.stack ? el("details.admin-error__stack", {}, [el("summary", {}, t("adminErr.stack")), el("pre", {}, e.stack)]) : null,
      el("div", {}, [
        el("button.btn.btn--ghost.btn--sm", {
          type: "button",
          onclick: async () => {
            try { await call("DELETE", adminErrorUrl(e.id)); toast(t("adminErr.fixed")); load(); } catch (err) { toast(err.message); }
          },
        }, [icon(ICONS.check, 15), t("adminErr.markFixed")]),
      ]),
    ].filter(Boolean));
  }

  async function load() {
    if (siteIsLocked()) { body.replaceChildren(gatePanel()); return; }
    if (!key) { body.replaceChildren(keyForm()); return; }
    body.replaceChildren(el("p.note", {}, t("adminRev.loading")));
    try {
      const data = await call("GET", ADMIN_ERRORS_URL);
      const list = data.errors.length ? data.errors.map(errorCard) : [el("p.note", {}, t("adminErr.empty"))];
      body.replaceChildren(
        el("div.admin-error__bar", {}, [
          el("p.note", {}, t("adminErr.totals", { kinds: data.totals.kinds, reports: data.totals.reports })),
          el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: load }, t("adminErr.refresh")),
        ]),
        ...list,
        el("button.linkbtn", {
          type: "button", style: { justifySelf: "start" },
          onclick: () => { key = ""; saveKey(""); load(); },
        }, t("adminRev.forgetKey")),
      );
    } catch (err) {
      if (err.siteLocked) { body.replaceChildren(gatePanel()); return; }
      if (err.auth) { key = ""; saveKey(""); body.replaceChildren(keyForm(err.message)); return; }
      clear(body).append(el("p.note.note--warn", {}, err.message));
    }
  }

  load();

  return {
    title: t("adminErr.title"),
    node: el("div.settings", {}, [
      homeButton({ grid: true }),
      el("h1", {}, t("adminErr.title")),
      el("p.note", {}, t("adminErr.intro")),
      body,
    ]),
  };
}

// "#/admin/reviews" — the moderation queue for reviews students write in #/rate. Not linked from
// anywhere in the app: whoever runs Studify opens it directly and types the REVIEW_ADMIN_KEY set on
// the server (`fly secrets set REVIEW_ADMIN_KEY=...`). The key is kept in sessionStorage for this tab
// only, so closing the tab forgets it. Server side: routes/reviews.js.

import { el, icon, ICONS, toast, clear } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { homeButton } from "../components/nav.js";
import { confirmDialog } from "../components/confirm-dialog.js";
import { ADMIN_REVIEWS_URL, adminReviewUrl } from "../config.js";

const KEY_STORE = "studify.reviewAdminKey";
const readKey = () => { try { return sessionStorage.getItem(KEY_STORE) || ""; } catch { return ""; } };
const saveKey = (k) => { try { k ? sessionStorage.setItem(KEY_STORE, k) : sessionStorage.removeItem(KEY_STORE); } catch {} };

const TABS = ["pending", "approved", "rejected"];

export function renderAdminReviews() {
  let key = readKey();
  let tab = "pending";

  const body = el("div", { style: { display: "grid", gap: "16px" } });

  async function call(method, url, payload) {
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json", "x-admin-key": key },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 403 || res.status === 404) {
      const err = new Error(res.status === 403 ? t("adminRev.wrongKey") : t("adminRev.notSetUp"));
      err.auth = true;
      throw err;
    }
    if (!res.ok) throw new Error(data?.error?.message || t("login.somethingWrong"));
    return data;
  }

  function keyForm(message) {
    const input = el("input", { type: "password", autocomplete: "off", required: true });
    const note = el("p.note.note--warn", { hidden: !message, role: "alert" }, message || "");
    return el("section.panel", {}, [
      el("p.note", { style: { marginBottom: "12px" } }, t("adminRev.keyIntro")),
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

  function reviewCard(r) {
    const act = async (fn, done) => {
      try { await fn(); toast(done); load(); } catch (err) { toast(err.message); }
    };
    const buttons = [
      r.status !== "approved" && el("button.btn.btn--sm", {
        type: "button",
        onclick: () => act(() => call("POST", adminReviewUrl(r.id), { status: "approved" }), t("adminRev.approved")),
      }, [icon(ICONS.check, 15), t("adminRev.approve")]),
      r.status !== "rejected" && el("button.btn.btn--ghost.btn--sm", {
        type: "button",
        onclick: () => act(() => call("POST", adminReviewUrl(r.id), { status: "rejected" }), t("adminRev.rejected")),
      }, t("adminRev.reject")),
      el("button.btn.btn--ghost.btn--sm", {
        type: "button", style: { color: "var(--retry-ink)" },
        onclick: async () => {
          if (!(await confirmDialog({ message: t("adminRev.deleteConfirm"), confirmLabel: t("adminRev.delete"), danger: true }))) return;
          act(() => call("DELETE", adminReviewUrl(r.id)), t("adminRev.deleted"));
        },
      }, t("adminRev.delete")),
    ].filter(Boolean);

    return el("article.panel.admin-review", {}, [
      el("p.lp-review__stars", { role: "img", "aria-label": t("lp.reviewStars", { n: r.rating }) },
        "★".repeat(r.rating) + "☆".repeat(5 - r.rating)),
      el("blockquote", { lang: r.lang }, [el("p", {}, r.text)]),
      el("p.note", {}, [
        el("b", {}, r.name), r.context ? ` · ${r.context}` : "", ` · ${r.date} · ${r.lang.toUpperCase()}`,
      ]),
      el("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } }, buttons),
    ]);
  }

  async function load() {
    if (!key) { body.replaceChildren(keyForm()); return; }
    body.replaceChildren(el("p.note", {}, t("adminRev.loading")));
    try {
      const data = await call("GET", `${ADMIN_REVIEWS_URL}?status=${tab}`);
      const tabs = el("div.admin-tabs", { role: "tablist" }, TABS.map((name) => el("button.btn.btn--sm" + (name === tab ? "" : ".btn--ghost"), {
        type: "button", role: "tab", "aria-selected": String(name === tab),
        onclick: () => { tab = name; load(); },
      }, `${t(`adminRev.tab.${name}`)} (${data.counts[name]})`)));
      const list = data.reviews.length
        ? data.reviews.map(reviewCard)
        : [el("p.note", {}, t("adminRev.empty"))];
      body.replaceChildren(tabs, ...list, el("button.linkbtn", {
        type: "button", style: { justifySelf: "start" },
        onclick: () => { key = ""; saveKey(""); load(); },
      }, t("adminRev.forgetKey")));
    } catch (err) {
      if (err.auth) { key = ""; saveKey(""); body.replaceChildren(keyForm(err.message)); return; }
      clear(body).append(el("p.note.note--warn", {}, err.message));
    }
  }

  load();

  return {
    title: t("adminRev.title"),
    node: el("div.settings", {}, [
      homeButton({ grid: true }),
      el("h1", {}, t("adminRev.title")),
      body,
    ]),
  };
}

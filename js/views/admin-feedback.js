// "#/admin/feedback" — the inbox for what students send with Tyck till: read it, give it a status, answer it
// (the sender sees the answer under "Dina förslag"). Not linked from anywhere in the app: whoever runs
// PluggEra opens it directly with the same admin key as #/admin/reviews (REVIEW_ADMIN_KEY on the server),
// kept in sessionStorage for this tab only. It never shows an email or an account id, only whether the
// sender can be answered. Server side: routes/feedback.js.

import { el, icon, ICONS, toast, clear } from "../lib/dom.js";
import { t, plural, getLang } from "../lib/i18n.js";
import { homeButton } from "../components/nav.js";
import { confirmDialog } from "../components/confirm-dialog.js";
import { ADMIN_FEEDBACK_URL, adminFeedbackUrl } from "../config.js";
import { openSiteGate, siteIsLocked } from "../components/site-gate-dialog.js";
import { KINDS } from "../lib/feedback.js";

// Shared with #/admin/reviews and #/admin/errors: one key, typed once per tab.
const KEY_STORE = "studify.reviewAdminKey";
const readKey = () => { try { return sessionStorage.getItem(KEY_STORE) || ""; } catch { return ""; } };
const saveKey = (k) => { try { k ? sessionStorage.setItem(KEY_STORE, k) : sessionStorage.removeItem(KEY_STORE); } catch {} };

const STATUSES = ["new", "seen", "planned", "done", "declined"];
const KIND_ICON = { idea: ICONS.idea, problem: ICONS.problem, praise: ICONS.heart, other: ICONS.feedback };
const dateText = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(getLang() === "sv" ? "sv-SE" : "en-GB", { day: "numeric", month: "short", year: "numeric" });

export function renderAdminFeedback() {
  let key = readKey();
  let status = "", kind = "";
  const body = el("div", { style: { display: "grid", gap: "12px" } });

  async function call(method, url, payload) {
    const res = await fetch(url, {
      method,
      headers: { "x-admin-key": key, ...(payload ? { "content-type": "application/json" } : {}) },
      body: payload ? JSON.stringify(payload) : undefined,
    });
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
      el("button.btn", { type: "button", onclick: () => openSiteGate("#/admin/feedback") }, t("gate.submit")),
    ]);
  }

  function keyForm(message) {
    const input = el("input", { type: "password", autocomplete: "off", required: true, id: "admin-feedback-key" });
    return el("section.panel", {}, [
      el("p.note", { style: { marginBottom: "12px" } }, t("adminFb.keyIntro")),
      el("form", {
        onsubmit: (e) => { e.preventDefault(); key = input.value.trim(); if (!key) return; saveKey(key); load(); },
      }, [
        el("label.field", {}, [el("span", {}, t("adminRev.keyLabel")), input]),
        el("p.note.note--warn", { hidden: !message, role: "alert" }, message || ""),
        el("button.btn", { type: "submit" }, t("adminRev.open")),
      ]),
    ]);
  }

  function stats(data) {
    const m = data.mood.last30days;
    const peak = Math.max(1, ...Object.values(m.byMood));
    const total = Object.values(data.counts).reduce((a, b) => a + b, 0);
    const stat = (value, label) => el("div.fb-stat", {}, [el("b", {}, String(value)), el("span", {}, label)]);
    return el("div.fb-stats", {}, [
      stat(data.counts.new, t("adminFb.stat.new")),
      stat(data.counts.planned, t("adminFb.stat.planned")),
      stat(total, t("adminFb.stat.total")),
      el("div.fb-stat", {}, [
        el("b", {}, m.average == null ? "–" : String(m.average).replace(".", getLang() === "sv" ? "," : ".")),
        el("span", {}, `${t("adminFb.stat.mood")} · ${plural(m.n, "adminFb.stat.answersOne", "adminFb.stat.answersMany")}`),
        el("div.fb-bars", { "aria-hidden": "true" }, [1, 2, 3, 4, 5].map((n) => el("i", { style: { height: `${Math.max(6, (m.byMood[n] / peak) * 100)}%` } }))),
      ]),
    ]);
  }

  function filters() {
    const chip = (label, active, on) => el("button.fb-filter", { type: "button", "aria-pressed": String(active), onclick: on }, label);
    return el("div.fb-filters", {}, [
      chip(t("adminFb.filter.all"), !status && !kind, () => { status = ""; kind = ""; load(); }),
      ...STATUSES.map((s) => chip(t(`feedback.status.${s}`), status === s, () => { status = status === s ? "" : s; load(); })),
      el("span.fb-filters__sep", { "aria-hidden": "true" }),
      ...KINDS.map((k) => chip(t(`feedback.kind.${k}`), kind === k, () => { kind = kind === k ? "" : k; load(); })),
    ]);
  }

  function card(row) {
    const badge = el(`span.fb-badge.fb-badge--${row.status}`, {}, t(`feedback.status.${row.status}`));
    const replyText = el("textarea.fb-text", { rows: 2, maxlength: "500", placeholder: t("adminFb.replyPlaceholder"), "aria-label": t("adminFb.replyPlaceholder") });
    replyText.value = row.reply || "";
    const replyBox = el("div.fb-replybox", { hidden: !row.reply }, [
      replyText,
      el("div.fb-meta", {}, [el("span", {}, t("adminFb.replyHint")), el("button.btn.btn--sm", {
        type: "button",
        onclick: async () => {
          try { await call("POST", adminFeedbackUrl(row.id), { reply: replyText.value.trim() }); toast(t("adminFb.replySaved")); load(); } catch (err) { toast(err.message); }
        },
      }, t("adminFb.replySave"))]),
    ]);
    const setStatus = (s) => async () => {
      try { await call("POST", adminFeedbackUrl(row.id), { status: s }); badge.className = `fb-badge fb-badge--${s}`; badge.textContent = t(`feedback.status.${s}`); } catch (err) { toast(err.message); }
    };
    return el("article.fb-item", {}, [
      el("div.fb-item__head", {}, [
        el("span.fb-kindtag", {}, [icon(KIND_ICON[row.kind], 16), t(`feedback.kind.${row.kind}`)]),
        row.mood ? el("span.fb-moodtag", {}, [icon(ICONS[`mood${row.mood}`], 16), t(`feedback.mood${row.mood}`)]) : null,
        el("span.note", {}, dateText(row.date)),
        badge,
      ]),
      row.message ? el("p.fb-item__msg", {}, row.message) : null,
      el("p.note", {}, [
        [row.route, row.browser, row.version].filter(Boolean).join(" · "),
        " · ", t(row.linked ? "adminFb.linked" : "adminFb.anonymous"),
      ]),
      el("div.fb-actions", {}, [
        ...STATUSES.filter((s) => s !== "new").map((s) => el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: setStatus(s) }, t(`feedback.status.${s}`))),
        row.linked ? el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => { replyBox.hidden = !replyBox.hidden; } }, t("adminFb.reply")) : null,
        el("button.linkbtn", {
          type: "button",
          onclick: async () => {
            if (!(await confirmDialog({ message: t("adminFb.deleteConfirm"), confirmLabel: t("adminFb.delete"), danger: true }))) return;
            try { await call("DELETE", adminFeedbackUrl(row.id)); toast(t("adminFb.deleted")); load(); } catch (err) { toast(err.message); }
          },
        }, t("adminFb.delete")),
      ]),
      row.linked ? replyBox : null,
    ]);
  }

  function query(before) {
    const q = new URLSearchParams();
    if (status) q.set("status", status);
    if (kind) q.set("kind", kind);
    if (before) q.set("before", String(before));
    const s = q.toString();
    return ADMIN_FEEDBACK_URL + (s ? `?${s}` : "");
  }

  async function load() {
    if (siteIsLocked()) { body.replaceChildren(gatePanel()); return; }
    if (!key) { body.replaceChildren(keyForm()); return; }
    body.replaceChildren(el("p.note", {}, t("adminRev.loading")));
    try {
      const data = await call("GET", query());
      const list = el("div.fb-list", {}, data.feedback.map(card));
      const more = el("button.btn.btn--ghost.btn--sm", { type: "button", hidden: data.feedback.length < 200 }, t("adminFb.more"));
      let last = data.feedback[data.feedback.length - 1];
      more.addEventListener("click", async () => {
        try {
          const next = await call("GET", query(last.cursor));
          list.append(...next.feedback.map(card));
          if (next.feedback.length) last = next.feedback[next.feedback.length - 1];
          more.hidden = next.feedback.length < 200;
        } catch (err) { toast(err.message); }
      });
      body.replaceChildren(
        stats(data), filters(),
        data.feedback.length ? list : el("p.note", {}, t("adminFb.empty")),
        more,
        el("button.linkbtn", { type: "button", style: { justifySelf: "start" }, onclick: () => { key = ""; saveKey(""); load(); } }, t("adminRev.forgetKey")),
      );
    } catch (err) {
      if (err.siteLocked) { body.replaceChildren(gatePanel()); return; }
      if (err.auth) { key = ""; saveKey(""); body.replaceChildren(keyForm(err.message)); return; }
      clear(body).append(el("p.note.note--warn", {}, err.message));
    }
  }

  load();

  return {
    title: t("adminFb.title"),
    node: el("div.settings.fbadmin", {}, [
      homeButton({ grid: true }),
      el("h1", {}, t("adminFb.title")),
      el("p.note", {}, t("adminFb.intro")),
      body,
    ]),
  };
}

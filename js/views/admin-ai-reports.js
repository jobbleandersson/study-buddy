// "#/admin/ai-reports" — AI answers students reported with "Rapportera" (components/ai-report.js). Like
// #/admin/reviews: not linked from the app, opened directly, and unlocked with the same REVIEW_ADMIN_KEY,
// kept for this tab only under the same sessionStorage key, so one key opens both pages. Server side:
// routes/ai-reports.js. Each report shows what the student had written, the AI's answer, why it was
// reported and their comment - never who sent it.

import { el, icon, ICONS, toast, clear } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { homeButton } from "../components/nav.js";
import { confirmDialog } from "../components/confirm-dialog.js";
import { ADMIN_AI_REPORTS_URL, adminAiReportUrl } from "../config.js";
import { openSiteGate, siteIsLocked } from "../components/site-gate-dialog.js";

const KEY_STORE = "studify.reviewAdminKey";   // shared with admin-reviews.js on purpose
const readKey = () => { try { return sessionStorage.getItem(KEY_STORE) || ""; } catch { return ""; } };
const saveKey = (k) => { try { k ? sessionStorage.setItem(KEY_STORE, k) : sessionStorage.removeItem(KEY_STORE); } catch {} };

const TABS = ["open", "handled"];

export function renderAdminAiReports() {
  let key = readKey();
  let tab = "open";
  const body = el("div", { style: { display: "grid", gap: "16px" } });

  async function call(method, url, payload) {
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json", "x-admin-key": key },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (data?.error?.code === "site_locked") { const err = new Error(t("adminRev.siteLocked")); err.siteLocked = true; throw err; }
    if (res.status === 403 || res.status === 404) {
      const err = new Error(res.status === 403 ? t("adminRev.wrongKey") : t("adminRev.notSetUp"));
      err.auth = true;
      throw err;
    }
    if (!res.ok) throw new Error(data?.error?.message || t("login.somethingWrong"));
    return data;
  }

  function gatePanel() {
    return el("section.panel", {}, [
      el("p.note", { style: { marginBottom: "12px" } }, t("adminRev.siteLocked")),
      el("button.btn", { type: "button", onclick: () => openSiteGate("#/admin/ai-reports") }, t("gate.submit")),
    ]);
  }

  function keyForm(message) {
    const input = el("input", { type: "password", autocomplete: "off", required: true, id: "admin-ai-key" });
    return el("section.panel", {}, [
      el("p.note", { style: { marginBottom: "12px" } }, t("adminRev.keyIntro")),
      el("form", { onsubmit: (e) => { e.preventDefault(); key = input.value.trim(); if (!key) return; saveKey(key); load(); } }, [
        el("label.field", { for: "admin-ai-key" }, [el("span", {}, t("adminRev.keyLabel")), input]),
        el("p.note.note--warn", { hidden: !message, role: "alert" }, message || ""),
        el("button.btn", { type: "submit" }, t("adminRev.open")),
      ]),
    ]);
  }

  function reportCard(r) {
    const act = async (fn, done) => { try { await fn(); toast(done); load(); } catch (err) { toast(err.message); } };
    const buttons = [
      r.status === "open"
        ? el("button.btn.btn--sm", { type: "button", onclick: () => act(() => call("POST", adminAiReportUrl(r.id), { status: "handled" }), t("adminAi.handled")) },
          [icon(ICONS.check, 15), t("adminAi.handle")])
        : el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => act(() => call("POST", adminAiReportUrl(r.id), { status: "open" }), t("adminAi.reopened")) },
          t("adminAi.reopen")),
      el("button.btn.btn--ghost.btn--sm", {
        type: "button", style: { color: "var(--retry-ink)" },
        onclick: async () => {
          if (!(await confirmDialog({ message: t("adminAi.deleteConfirm"), confirmLabel: t("adminAi.delete"), danger: true }))) return;
          act(() => call("DELETE", adminAiReportUrl(r.id)), t("adminAi.deleted"));
        },
      }, t("adminAi.delete")),
    ];
    return el("article.panel.admin-aireport", {}, [
      el("p.admin-aireport__meta", {}, [
        el("span.tag" + (r.reason === "harmful" ? ".admin-aireport__tag--harmful" : ""), {}, t(`aiReport.reason.${r.reason}`)),
        ` ${t(r.where === "solve" ? "adminAi.whereSolve" : "adminAi.whereTutor")} · ${r.date}`,
      ]),
      r.prompt ? el("div", {}, [el("p.admin-aireport__label", {}, t("adminAi.asked")), el("blockquote.admin-aireport__text", {}, r.prompt)]) : null,
      el("div", {}, [el("p.admin-aireport__label", {}, t("adminAi.answer")), el("blockquote.admin-aireport__text", {}, r.content)]),
      r.note ? el("div", {}, [el("p.admin-aireport__label", {}, t("adminAi.note")), el("blockquote.admin-aireport__text", {}, r.note)]) : null,
      el("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } }, buttons),
    ].filter(Boolean));
  }

  async function load() {
    if (siteIsLocked()) { body.replaceChildren(gatePanel()); return; }
    if (!key) { body.replaceChildren(keyForm()); return; }
    body.replaceChildren(el("p.note", {}, t("adminRev.loading")));
    try {
      const data = await call("GET", `${ADMIN_AI_REPORTS_URL}?status=${tab}`);
      const tabs = el("div.admin-tabs", { role: "tablist" }, TABS.map((name) => el("button.btn.btn--sm" + (name === tab ? "" : ".btn--ghost"), {
        type: "button", role: "tab", "aria-selected": String(name === tab),
        onclick: () => { tab = name; load(); },
      }, `${t(`adminAi.tab.${name}`)} (${data.counts[name]})`)));
      const list = data.reports.length ? data.reports.map(reportCard) : [el("p.note", {}, t("adminAi.empty"))];
      body.replaceChildren(tabs, ...list, el("button.linkbtn", {
        type: "button", style: { justifySelf: "start" },
        onclick: () => { key = ""; saveKey(""); load(); },
      }, t("adminRev.forgetKey")));
    } catch (err) {
      if (err.siteLocked) { body.replaceChildren(gatePanel()); return; }
      if (err.auth) { key = ""; saveKey(""); body.replaceChildren(keyForm(err.message)); return; }
      clear(body).append(el("p.note.note--warn", {}, err.message));
    }
  }

  load();

  return {
    title: t("adminAi.title"),
    node: el("div.settings", {}, [homeButton({ grid: true }), el("h1", {}, t("adminAi.title")), body]),
  };
}

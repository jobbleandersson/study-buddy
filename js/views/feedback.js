// "#/feedback" — Tyck till. Two tabs: "Skicka" (the form) and "Dina förslag" (what the student has sent, the
// status we gave it and our reply). Signed in only; signed out it shows what Tyck till is and a way in.
// Opened from the top bar's "Tyck till" button. Server side: routes/feedback.js. We read them at
// #/admin/feedback.

import { el, icon, ICONS, toast, clear } from "../lib/dom.js";
import { t, getLang } from "../lib/i18n.js";
import { store } from "../store.js";
import { homeButton } from "../components/nav.js";
import { feedbackForm, feedbackSignedOut } from "../components/feedback-form.js";
import { confirmDialog } from "../components/confirm-dialog.js";
import { signInGate } from "../components/signin-gate.js";
import { loadMine, takeBack } from "../lib/feedback.js";
import { myFeedbackImageUrl } from "../config.js";

const dateText = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(getLang() === "sv" ? "sv-SE" : "en-GB", { day: "numeric", month: "short" });

/** A face for a mood, as small text next to a message. */
const moodTag = (n) => el("span.fb-moodtag", { title: t(`feedback.mood${n}`) }, [icon(ICONS[`mood${n}`], 16), t(`feedback.mood${n}`)]);

function mineItem(row, reload) {
  return el("article.fb-item", {}, [
    el("div.fb-item__head", {}, [
      el(`span.fb-badge.fb-badge--${row.status}`, {}, t(`feedback.status.${row.status}`)),
      el("span.note", {}, dateText(row.date)),
    ]),
    row.message ? el("p.fb-item__msg", {}, row.message) : null,
    row.mood && !row.message ? el("p.fb-item__msg", {}, moodTag(row.mood)) : null,
    // The screenshots sent with it; each opens full size in a new tab.
    row.images ? el("div.fb-shots__list", {}, Array.from({ length: row.images }, (_, n) =>
      el("a.fb-shot", { href: myFeedbackImageUrl(row.id, n), target: "_blank", rel: "noopener" }, [
        el("img", { src: myFeedbackImageUrl(row.id, n), alt: t("feedback.imageAlt", { n: n + 1 }), loading: "lazy" }),
      ]))) : null,
    row.reply ? el("div.fb-reply", {}, [el("strong", {}, t("feedback.mine.reply")), el("p", {}, row.reply)]) : null,
    el("div", {}, [
      el("button.linkbtn", {
        type: "button",
        onclick: async () => {
          if (!(await confirmDialog({ message: t("feedback.mine.takeBackConfirm"), confirmLabel: t("feedback.mine.takeBack"), danger: true }))) return;
          try { await takeBack(row.id); toast(t("feedback.mine.takenBack")); reload(); } catch { toast(t("login.somethingWrong")); }
        },
      }, t("feedback.mine.takeBack")),
    ]),
  ]);
}

/** Signed out: what Tyck till is for, a way in that comes back here, and the contact form for anyone who'd
 *  rather not sign in — beside a made-up preview of the page (components/signin-gate.js). */
function signedOutGate() {
  return el("div.settings", {}, [
    homeButton({ grid: true }),
    signInGate({
      eyebrowIcon: ICONS.feedback, eyebrow: t("feedback.title"),
      title: t("feedback.gateTitle"), lead: t("feedback.gateLead"),
      points: [
        [ICONS.idea, t("feedback.gateIdeaHead"), t("feedback.gateIdeaBody")],
        [ICONS.image, t("feedback.gateShotHead"), t("feedback.gateShotBody")],
        [ICONS.message, t("feedback.gateReplyHead"), t("feedback.gateReplyBody")],
      ],
      preview: feedbackPreview(),
      next: "#/feedback",
      foot: [t("feedback.gateNoAccount"), " ", el("a", { href: "#/contact" }, t("feedback.gateContact"))],
    }),
  ]);
}

/** The preview: the five faces with one picked, and an idea under "Dina förslag" with its status and our
 *  reply — so the visitor sees that an answer comes back. */
function feedbackPreview() {
  return el("div.gart", {}, [
    el("div.gart__box", {}, [
      el("p.gart__label", {}, t("feedback.moodLabel")),
      el("div.fbprev__faces", {}, [1, 2, 3, 4, 5].map((n) =>
        el(`span.fb-face.fb-face--${n}`, { "aria-pressed": String(n === 4) }, [icon(ICONS[`mood${n}`], 18)]))),
    ]),
    el("div.gart__box", {}, [
      el("p.gart__label", {}, t("feedback.tab.mine")),
      el("div.gart__row", {}, [
        el("span.fb-kindtag.fbprev__kind", {}, [icon(ICONS.idea, 15), t("feedback.kind.idea")]),
        el("span.fb-badge.fb-badge--planned", {}, t("feedback.status.planned")),
      ]),
      el("p.fbprev__msg", {}, t("feedback.demoMessage")),
      el("div.fb-reply", {}, [el("strong", {}, t("feedback.mine.reply")), el("p", {}, t("feedback.demoReply"))]),
    ]),
  ]);
}

export function renderFeedback(qs) {
  const lead = el("p.fb-lead", {}, t("feedback.lead"));
  const head = [homeButton({ grid: true }), el("h1", {}, t("feedback.title")), lead];
  const back = el("a.btn.btn--ghost.pageback", { href: "#/", style: { justifySelf: "start" } }, [icon(ICONS.back, 16), t("common.backToMenu")]);

  if (!store.authed) {
    // Without the server there is nothing to sign in to: the plain panel says so.
    if (!store.proxyUp) return { title: t("feedback.title"), node: el("div.settings.fbpage", {}, [...head, feedbackSignedOut(), back]) };
    return { title: t("feedback.title"), node: signedOutGate() };
  }

  const panes = { send: el("div", {}), mine: el("div", { hidden: true }) };
  const tabs = {};
  function show(name) {
    for (const [k, b] of Object.entries(tabs)) b.setAttribute("aria-selected", String(k === name));
    for (const [k, p] of Object.entries(panes)) p.hidden = k !== name;
    if (name === "mine") reload();
  }
  for (const name of ["send", "mine"]) {
    tabs[name] = el("button.fb-tab", { type: "button", role: "tab", "aria-selected": "false", onclick: () => show(name) }, t(`feedback.tab.${name}`));
  }

  panes.send.append(el("section.panel", {}, [feedbackForm({ context: "page", moods: true, rows: 5 })]));

  async function reload() {
    clear(panes.mine).append(el("p.note", {}, t("adminRev.loading")));
    try {
      const rows = await loadMine();
      clear(panes.mine).append(
        el("p.note", {}, t("feedback.mine.lead")),
        rows.length
          ? el("div.fb-list", {}, rows.map((r) => mineItem(r, reload)))
          : el("section.panel", {}, [el("p", {}, t("feedback.mine.empty"))]),
      );
    } catch {
      clear(panes.mine).append(el("p.note.note--warn", {}, t("login.somethingWrong")));
    }
  }

  const node = el("div.settings.fbpage", {}, [
    ...head,
    el("div.fb-tabs", { role: "tablist" }, [tabs.send, tabs.mine]),
    panes.send, panes.mine,
    back,
  ]);
  show(qs?.get("tab") === "mine" ? "mine" : "send");
  return { title: t("feedback.title"), node };
}

// The "Tyck till" form, shared by the #/feedback page and the help panel's second tab: how it feels
// (optional), what it is about, the words, and "send without my account". Sending goes through
// lib/feedback.js. Signed out there is nothing to send to, so it says so and points at sign-in and the
// contact form. Server side: routes/feedback.js.

import { el, icon, ICONS } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { store } from "../store.js";
import { KINDS, MOODS, MESSAGE_MAX, MESSAGE_MIN, sendFeedback } from "../lib/feedback.js";

const KIND_ICON = { idea: ICONS.idea, problem: ICONS.problem, praise: ICONS.heart, other: ICONS.feedback };

/** Five faces from "mycket dåligt" to "mycket bra". Tapping the one that is on turns it off again.
 *  Real buttons with aria-pressed, so keyboard and screen readers work as usual. */
export function moodPicker({ onChange, size = 26 } = {}) {
  let value = null;
  const buttons = MOODS.map((n) => el("button.fb-face", {
    type: "button", "aria-pressed": "false", "aria-label": t(`feedback.mood${n}`), title: t(`feedback.mood${n}`),
    onclick: () => set(value === n ? null : n, true),
  }, [icon(ICONS[`mood${n}`], size)]));
  function set(n, notify) {
    value = n;
    buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(MOODS[i] === n)));
    if (notify) onChange?.(n);
  }
  const node = el("div.fb-faces", { role: "group", "aria-label": t("feedback.moodLabel") }, buttons);
  return { node, set: (n) => set(n, false), get value() { return value; } };
}

/** The sign-in panel for someone who isn't (or whose server isn't) there. */
export function feedbackSignedOut() {
  return el("section.panel.fb-signedout", {}, [
    el("p", {}, t("feedback.signInIntro")),
    store.proxyUp
      ? el("div.fb-signedout__row", {}, [
        el("a.btn.btn--sm", { href: "#/login" }, t("login.signIn")),
        el("a.btn.btn--ghost.btn--sm", { href: "#/contact" }, t("feedback.contactInstead")),
      ])
      : el("p.note.note--warn", {}, t("feedback.noServer")),
  ]);
}

/**
 * context: where it was opened from ("page" | "button" | "after-session" | "after-results"), sent along.
 * moods: show the five faces. rows: height of the text box. hint: a line above the form.
 * onSent: called after a successful send.
 */
export function feedbackForm({ context = "page", moods = true, rows = 4, hint = null, onSent = null } = {}) {
  if (!store.authed) return feedbackSignedOut();

  let kind = "idea";
  const mood = moodPicker({ onChange: () => { errorNote.hidden = true; } });
  const kindButtons = KINDS.map((k) => el("button.fb-kind", {
    type: "button", "aria-pressed": String(k === kind), dataset: { kind: k },
    onclick: () => {
      kind = k;
      kindButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.kind === k)));
    },
  }, [icon(KIND_ICON[k], 20), t(`feedback.kind.${k}`)]));

  const counter = el("span.fb-count", { "aria-live": "off" }, `0 / ${MESSAGE_MAX}`);
  const text = el("textarea.fb-text", {
    rows, maxlength: String(MESSAGE_MAX), placeholder: t("feedback.textPlaceholder"), "aria-label": t("feedback.textLabel"),
    oninput: () => { errorNote.hidden = true; counter.textContent = `${text.value.length} / ${MESSAGE_MAX}`; },
  });
  const anon = el("input", { type: "checkbox", id: `fb-anon-${Math.random().toString(36).slice(2, 7)}` });
  const errorNote = el("p.note.note--warn", { hidden: true, role: "alert" });
  const send = el("button.btn", { type: "submit" }, t("feedback.send"));

  const body = el("form.fb-form", { novalidate: true, onsubmit: submit }, [
    hint ? el("p.fb-hint", {}, hint) : null,
    moods ? el("div.fb-block", {}, [el("p.fb-label", {}, t("feedback.moodLabel")), mood.node]) : null,
    el("div.fb-block", {}, [
      el("p.fb-label", {}, t("feedback.kindLabel")),
      el("div.fb-kinds", { role: "group", "aria-label": t("feedback.kindLabel") }, kindButtons),
    ]),
    el("div.fb-block", {}, [text, el("div.fb-meta", {}, [el("span", {}, t("feedback.sentWith")), counter])]),
    el("label.fb-check", { for: anon.id }, [anon, el("span", {}, [t("feedback.anon"), el("small", {}, t("feedback.anonHint"))])]),
    errorNote,
    send,
  ]);

  const done = el("div.fb-done", { hidden: true, role: "status" }, [
    icon(ICONS.check, 36),
    el("h3", {}, t("feedback.thanksTitle")),
    el("p", {}, t("feedback.thanksBody")),
    el("a.btn.btn--ghost.btn--sm", { href: "#/feedback?tab=mine" }, t("feedback.seeMine")),
  ]);

  async function submit(e) {
    e.preventDefault();
    errorNote.hidden = true;
    const message = text.value.trim();
    if (message.length < MESSAGE_MIN && mood.value == null) {
      errorNote.textContent = t(moods ? "feedback.errTextOrMood" : "feedback.errText");
      errorNote.hidden = false;
      return;
    }
    send.disabled = true;
    try {
      await sendFeedback({ kind, message, mood: mood.value, context, anonymous: anon.checked }, t("login.somethingWrong"));
      body.hidden = true;
      done.hidden = false;
      onSent?.();
    } catch (err) {
      errorNote.textContent = err.message;
      errorNote.hidden = false;
    } finally {
      send.disabled = false;
    }
  }

  return el("div.fb", {}, [body, done]);
}

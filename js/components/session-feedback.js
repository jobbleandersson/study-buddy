// "Hur gick passet?" — one tap on a face under the score on the results screen, then an optional line of
// words. Shown now and then (lib/feedback.js: shouldAskAfterSession), never to someone signed out, and
// asked at most once every few days whether it is answered or skipped. The face is sent the moment it is
// tapped; the words, if any, go as a second message without a mood, so one tap is counted once.

import { el, icon, ICONS } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { store } from "../store.js";
import { isFreshResult, shouldAskAfterSession, lastAskedAt, markAsked, sendFeedback, MESSAGE_MIN, MESSAGE_MAX } from "../lib/feedback.js";
import { moodPicker } from "./feedback-form.js";

/** The card, or null when it isn't time to ask. `finishedAt`: when the session being shown ended; an old
 *  one opened from the progress page doesn't get asked about. */
export function sessionFeedbackCard(finishedAt) {
  if (!isFreshResult(finishedAt)) return null;
  if (!shouldAskAfterSession({ authed: store.authed, sessions: store.attempts.length, lastAskedAt: lastAskedAt() })) return null;
  markAsked();

  const error = el("p.note.note--warn", { hidden: true, role: "alert" });
  const fail = (err) => { error.textContent = err.message; error.hidden = false; };
  const steps = {};
  const show = (name) => Object.entries(steps).forEach(([k, node]) => { node.hidden = k !== name; });

  const mood = moodPicker({
    size: 28,
    async onChange(n) {
      error.hidden = true;
      if (n == null) return;
      try {
        await sendFeedback({ kind: "other", mood: n, context: "after-session" }, t("login.somethingWrong"));
        show("more");
        steps.more.querySelector("textarea")?.focus();
      } catch (err) { mood.set(null); fail(err); }
    },
  });

  steps.ask = el("div", {}, [
    el("h3", {}, t("feedback.after.title")),
    el("p.fb-after__sub", {}, t("feedback.after.sub")),
    mood.node,
    el("button.fb-after__skip", { type: "button", onclick: () => show("thanks") }, t("feedback.after.skip")),
  ]);

  const text = el("textarea.fb-text", { rows: 3, maxlength: String(MESSAGE_MAX), placeholder: t("feedback.after.placeholder"), "aria-label": t("feedback.after.placeholder") });
  const sendMore = el("button.btn.btn--sm", {
    type: "button",
    async onclick() {
      error.hidden = true;
      const message = text.value.trim();
      if (message.length < MESSAGE_MIN) return show("thanks");
      sendMore.disabled = true;
      try {
        await sendFeedback({ kind: "other", message, context: "after-session" }, t("login.somethingWrong"));
        show("thanks");
      } catch (err) { fail(err); } finally { sendMore.disabled = false; }
    },
  }, t("feedback.send"));
  steps.more = el("div", { hidden: true }, [
    el("h3", {}, t("feedback.after.moreTitle")),
    el("p.fb-after__sub", {}, t("feedback.after.moreSub")),
    text,
    el("div.fb-after__row", {}, [
      el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => show("thanks") }, t("feedback.after.no")),
      sendMore,
    ]),
  ]);

  steps.thanks = el("div.fb-after__thanks", { hidden: true, role: "status" }, [icon(ICONS.check, 28), el("h3", {}, t("feedback.after.thanks"))]);

  return el("section.panel.fb-after", { "aria-label": t("feedback.after.title") }, [steps.ask, steps.more, steps.thanks, error]);
}

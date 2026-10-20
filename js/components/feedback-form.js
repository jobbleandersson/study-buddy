// The "Tyck till" form, shared by the #/feedback page and the help panel's second tab: how it feels
// (optional), what it is about, the words, up to three screenshots, and "send without my account".
// Sending goes through lib/feedback.js. Signed out there is nothing to send to, so it says so and points
// at sign-in and the contact form. Server side: routes/feedback.js.

import { el, icon, ICONS } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { store } from "../store.js";
import { KINDS, MOODS, MESSAGE_MAX, MESSAGE_MIN, IMAGE_MAX, prepareImage, sendFeedback } from "../lib/feedback.js";

const KIND_ICON = { idea: ICONS.idea, problem: ICONS.problem, praise: ICONS.heart, other: ICONS.feedback };

/** "Lägg till bild": up to IMAGE_MAX screenshots, from the button, pasted or dropped on the form (see
 *  feedbackForm). Each is shrunk in the browser before it is kept (lib/feedback.js prepareImage), so what is
 *  sent is small. `onError(message)` shows a problem with one. */
function screenshotPicker({ onError }) {
  const shots = [];   // { data (base64), preview (data URL) }
  let pending = 0;    // being shrunk right now
  const input = el("input", {
    type: "file", accept: "image/png,image/jpeg,image/webp,image/gif", multiple: true, hidden: true,
    onchange: () => { add([...input.files]); input.value = ""; },
  });
  const addBtn = el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => input.click() }, [icon(ICONS.image, 16), t("feedback.addImage")]);
  const hint = el("span.fb-shots__hint", {});
  const busy = el("span.fb-shots__busy", { role: "status" });
  const list = el("div.fb-shots__list");

  function paint() {
    list.replaceChildren(...shots.map((s, i) => el("figure.fb-shot", {}, [
      el("img", { src: s.preview, alt: t("feedback.imageAlt", { n: i + 1 }) }),
      el("button.fb-shot__x", {
        type: "button", "aria-label": t("feedback.imageRemove", { n: i + 1 }), title: t("feedback.imageRemove", { n: i + 1 }),
        onclick: () => { shots.splice(i, 1); paint(); addBtn.focus(); },
      }, [icon(ICONS.close, 14)]),
    ])));
    list.hidden = !shots.length;
    addBtn.disabled = shots.length + pending >= IMAGE_MAX;
    hint.textContent = shots.length ? t("feedback.imageCount", { n: shots.length, max: IMAGE_MAX }) : t("feedback.imageHint");
    busy.textContent = pending ? t("feedback.imagePreparing") : "";
  }

  /** Adds the pictures among `files`; false when there were none (a paste of plain text, say). */
  function add(files) {
    const pictures = files.filter((f) => f?.type?.startsWith("image/"));
    if (!pictures.length) return false;
    const room = IMAGE_MAX - shots.length - pending;
    if (pictures.length > room) onError(t("feedback.imageMax"));
    const take = pictures.slice(0, Math.max(0, room));
    pending += take.length;
    paint();
    (async () => {
      for (const file of take) {
        try { shots.push(await prepareImage(file)); } catch (err) { onError(err.message); }
        pending--;
        paint();
      }
    })();
    return true;
  }

  paint();
  return {
    node: el("div.fb-shots", {}, [el("div.fb-shots__bar", {}, [addBtn, hint, busy]), list, input]),
    add,
    get images() { return shots.map((s) => s.data); },
    get busy() { return pending > 0; },
  };
}

/** Five faces from "mycket dåligt" to "mycket bra", each in its own colour from red to green
 *  (.fb-face--1 to --5 in app.css). Tapping the one that is on turns it off again. Real buttons with
 *  aria-pressed, so keyboard and screen readers work as usual. */
export function moodPicker({ onChange, size = 26 } = {}) {
  let value = null;
  const buttons = MOODS.map((n) => el(`button.fb-face.fb-face--${n}`, {
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
  const shots = screenshotPicker({ onError: (message) => { errorNote.textContent = message; errorNote.hidden = false; } });

  const body = el("form.fb-form", { novalidate: true, onsubmit: submit }, [
    hint ? el("p.fb-hint", {}, hint) : null,
    moods ? el("div.fb-block", {}, [el("p.fb-label", {}, t("feedback.moodLabel")), mood.node]) : null,
    el("div.fb-block", {}, [
      el("p.fb-label", {}, t("feedback.kindLabel")),
      el("div.fb-kinds", { role: "group", "aria-label": t("feedback.kindLabel") }, kindButtons),
    ]),
    el("div.fb-block", {}, [text, shots.node, el("div.fb-meta", {}, [el("span", {}, t("feedback.sentWith")), counter])]),
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

  // A screenshot can be pasted anywhere in the form (Ctrl+V, or "Klistra in" on a phone) or dropped on it.
  // Text pastes as usual: only a paste with a picture in it is taken over.
  body.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.items || [])].filter((it) => it.kind === "file").map((it) => it.getAsFile());
    if (shots.add(files)) e.preventDefault();
  });
  body.addEventListener("dragover", (e) => {
    if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
    e.preventDefault();
    body.classList.add("is-dropping");
  });
  body.addEventListener("dragleave", (e) => { if (!body.contains(e.relatedTarget)) body.classList.remove("is-dropping"); });
  body.addEventListener("drop", (e) => {
    body.classList.remove("is-dropping");
    if (e.dataTransfer?.files?.length) { e.preventDefault(); shots.add([...e.dataTransfer.files]); }
  });

  async function submit(e) {
    e.preventDefault();
    errorNote.hidden = true;
    const message = text.value.trim();
    if (shots.busy) {
      errorNote.textContent = t("feedback.imageWait");
      errorNote.hidden = false;
      return;
    }
    // A screenshot says enough on its own.
    if (message.length < MESSAGE_MIN && mood.value == null && !shots.images.length) {
      errorNote.textContent = t(moods ? "feedback.errTextOrMood" : "feedback.errText");
      errorNote.hidden = false;
      return;
    }
    send.disabled = true;
    try {
      await sendFeedback({ kind, message, mood: mood.value, context, anonymous: anon.checked, images: shots.images }, t("login.somethingWrong"));
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

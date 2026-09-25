// "#/rate" — a signed-in student writes (or edits, or takes back) their one review of Studify.
// Nothing goes public from here: the server keeps it as 'pending' until it's approved in
// #/admin/reviews, and only then does it show on the front page. Server side: routes/reviews.js.

import { el, icon, ICONS, toast } from "../lib/dom.js";
import { t, getLang } from "../lib/i18n.js";
import { store } from "../store.js";
import { homeButton } from "../components/nav.js";
import { serverMessage } from "../lib/server-errors.js";
import { REVIEWS_URL, MY_REVIEW_URL } from "../config.js";

const TEXT_MAX = 600;

function signedOutNode() {
  return el("div.settings", {}, [
    homeButton({ grid: true }),
    el("h1", {}, t("rate.title")),
    el("section.panel", {}, [
      el("p.note", { style: { marginBottom: "12px" } }, t("rate.signInIntro")),
      store.proxyUp
        ? el("a.btn", { href: "#/login" }, t("login.signIn"))
        : el("p.note.note--warn", {}, t("rate.noServer")),
    ]),
    el("a.btn.btn--ghost", { href: "#/" }, [icon(ICONS.back, 16), t("common.backToMenu")]),
  ]);
}

/** Five radio buttons styled as stars: real radios, so arrow keys and screen readers work as usual. */
function starPicker(onChange) {
  let value = 0;
  const inputs = [];
  const labels = [1, 2, 3, 4, 5].map((n) => {
    const input = el("input.rate-stars__input", {
      type: "radio", name: "rate-stars", value: String(n),
      onchange: () => { set(n); onChange(n); },
    });
    inputs.push(input);
    return el("label.rate-stars__star", { title: t("rate.starsN", { n }) }, [
      input,
      el("span", { "aria-hidden": "true" }, "★"),
      el("span.sr-only", {}, t("rate.starsN", { n })),
    ]);
  });
  function set(n) {
    value = n;
    labels.forEach((l, i) => l.classList.toggle("is-on", i < n));
    inputs.forEach((inp, i) => { inp.checked = i + 1 === n; });
  }
  const node = el("fieldset.rate-stars", {}, [el("legend", {}, t("rate.starsLabel")), el("div.rate-stars__row", {}, labels)]);
  return { node, set, get value() { return value; } };
}

export function renderRate() {
  if (!store.authed) return { title: t("rate.title"), node: signedOutNode() };

  const statusNote = el("p.note", { hidden: true });
  const errorNote = el("p.note.note--warn", { hidden: true, role: "alert" });
  const stars = starPicker(() => { errorNote.hidden = true; });
  const counter = el("span.rate-count", { "aria-live": "polite" }, `0 / ${TEXT_MAX}`);
  const textInput = el("textarea", {
    maxlength: String(TEXT_MAX), rows: 5, required: true, placeholder: t("rate.textPlaceholder"),
    oninput: () => { counter.textContent = `${textInput.value.length} / ${TEXT_MAX}`; },
  });
  const nameInput = el("input", { type: "text", maxlength: "30", required: true, autocomplete: "given-name", placeholder: t("rate.namePlaceholder") });
  const contextInput = el("input", { type: "text", maxlength: "60", placeholder: t("rate.contextPlaceholder") });
  const consentInput = el("input", { type: "checkbox" });
  const submitBtn = el("button.btn", { type: "submit" }, t("rate.send"));
  const withdrawBtn = el("button.btn.btn--ghost", { type: "button", hidden: true, onclick: withdraw }, t("rate.withdraw"));

  const form = el("form", { onsubmit: submit, novalidate: true }, [
    stars.node,
    el("label.field", {}, [el("span", {}, t("rate.textLabel")), textInput, counter]),
    el("label.field", {}, [el("span", {}, t("rate.nameLabel")), nameInput, el("small.note", {}, t("rate.nameHint"))]),
    el("label.field", {}, [el("span", {}, t("rate.contextLabel")), contextInput]),
    el("label.field.consentrow", {}, [consentInput, el("span", {}, t("rate.consent"))]),
    errorNote,
    el("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap" } }, [submitBtn, withdrawBtn]),
  ]);

  function showStatus(status) {
    statusNote.hidden = !status;
    if (!status) return;
    statusNote.className = "note" + (status === "rejected" ? " note--warn" : "");
    statusNote.textContent = t(`rate.status.${status}`);
    withdrawBtn.hidden = false;
    submitBtn.textContent = t("rate.update");
  }

  // Fill in what they sent before, if anything.
  fetch(MY_REVIEW_URL, { credentials: "include" })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      const r = data?.review;
      if (!r) return;
      stars.set(r.rating);
      textInput.value = r.text;
      counter.textContent = `${r.text.length} / ${TEXT_MAX}`;
      nameInput.value = r.name;
      contextInput.value = r.context || "";
      consentInput.checked = true;
      showStatus(r.status);
    })
    .catch(() => { /* offline: an empty form still works */ });

  function fail(message) {
    errorNote.textContent = message;
    errorNote.hidden = false;
  }

  async function submit(e) {
    e.preventDefault();
    errorNote.hidden = true;
    const text = textInput.value.trim();
    if (!stars.value) return fail(t("rate.errStars"));
    if (text.length < 10) return fail(t("rate.errText"));
    if (!nameInput.value.trim()) return fail(t("rate.errName"));
    if (!consentInput.checked) return fail(t("rate.errConsent"));

    submitBtn.disabled = true;
    try {
      const res = await fetch(REVIEWS_URL, {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rating: stars.value, text, name: nameInput.value.trim(), context: contextInput.value.trim(),
          // The language it's written in is the one the app is in — the form is too.
          lang: getLang() === "en" ? "en" : "sv",
          consent: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(serverMessage(data?.error?.message, t("login.somethingWrong")));
      showStatus("pending");
      toast(t("rate.sent"));
    } catch (err) {
      fail(err.message);
    } finally {
      submitBtn.disabled = false;
    }
  }

  async function withdraw() {
    withdrawBtn.disabled = true;
    try {
      const res = await fetch(MY_REVIEW_URL, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error(t("login.somethingWrong"));
      form.reset();
      stars.set(0);
      counter.textContent = `0 / ${TEXT_MAX}`;
      statusNote.hidden = true;
      withdrawBtn.hidden = true;
      submitBtn.textContent = t("rate.send");
      toast(t("rate.withdrawn"));
    } catch (err) {
      fail(err.message);
    } finally {
      withdrawBtn.disabled = false;
    }
  }

  return {
    title: t("rate.title"),
    node: el("div.settings", {}, [
      homeButton({ grid: true }),
      el("h1", {}, t("rate.title")),
      el("p.note", { style: { marginBottom: "16px" } }, t("rate.lead")),
      el("section.panel", {}, [statusNote, form]),
      el("a.btn.btn--ghost", { href: "#/", style: { justifySelf: "start" } }, [icon(ICONS.back, 16), t("common.backToMenu")]),
    ]),
  };
}

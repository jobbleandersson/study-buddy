// "#/contact" — a form that mails the team (POST /api/contact, see server/src/routes/contact.js),
// with the address beside it for anyone who'd rather write from their own mail app. Open while the
// site is private, like the other information pages; the API isn't, so a visitor without the site
// password (or a server with email off) gets their own mail app with the message already filled in.

import { el, icon, ICONS, toast } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { store } from "../store.js";
import { homeButton } from "../components/nav.js";
import { serverMessage } from "../lib/server-errors.js";
import { CONTACT_EMAIL, CONTACT_URL } from "../config.js";

// A contact card: a person and an envelope, in the brand colour.
const CARD_SVG = `<svg viewBox="0 0 72 56" width="72" height="56" aria-hidden="true">
  <rect width="72" height="56" rx="12" fill="var(--brand)"/>
  <circle cx="23" cy="22" r="7.5" fill="#fff"/>
  <path d="M10 44.5c0-7.2 5.8-12 13-12s13 4.8 13 12v.5H10z" fill="#fff"/>
  <rect x="41" y="13" width="21" height="15" rx="2.5" fill="#fff"/>
  <path d="M42.5 15l9 6.5 9-6.5" fill="none" stroke="var(--brand)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="41" y="34" width="21" height="3.5" rx="1.75" fill="#fff" opacity=".55"/>
</svg>`;

const MAX_MESSAGE = 5000;

function field(id, labelKey, control) {
  return el("div.contact__field", {}, [el("label", { for: id }, t(labelKey)), control]);
}

export function renderContact() {
  const name = el("input#contact-name.contact__input", {
    type: "text", required: true, maxlength: 100, autocomplete: "name", placeholder: t("contact.namePh"),
  });
  const email = el("input#contact-email.contact__input", {
    type: "email", required: true, maxlength: 254, autocomplete: "email", placeholder: t("login.emailPlaceholder"),
    value: store.authed && store.authEmail ? store.authEmail : "",
  });
  const message = el("textarea#contact-message.contact__input.contact__textarea", {
    required: true, rows: 6, maxlength: MAX_MESSAGE, placeholder: t("contact.messagePh"),
  });
  // Never seen or reached by a person; a bot filling every field fills this too (see routes/contact.js).
  // Deliberately a name no autofill recognises ("website" is one some fill in), or a real message
  // would be dropped as spam.
  const honeypot = el("input.contact__hp", { type: "text", name: "hp_x7", tabindex: "-1", autocomplete: "off", "aria-hidden": "true" });

  const note = el("div.contact__note", { role: "alert", hidden: true });
  const sendLabel = el("span", {}, t("contact.send"));
  const submitBtn = el("button.btn.contact__send", { type: "submit" }, [sendLabel, icon(ICONS.arrow, 18)]);

  const form = el("form.contact__form", { onsubmit: submit }, [
    field("contact-name", "contact.name", name),
    field("contact-email", "contact.email", email),
    field("contact-message", "contact.message", message),
    honeypot,
    note,
    submitBtn,
    el("p.contact__fine", {}, t("contact.fine")),
  ]);
  const card = el("section.contact__card", { "aria-labelledby": "contact-title" }, [form]);

  const mailtoHref = () => {
    const who = name.value.trim();
    const subject = t("contact.mailSubject", { name: who || "PluggEra" });
    const body = message.value.trim() + (who ? `\n\n${who}` : "");
    return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  function showNote(text, { fallback = false } = {}) {
    note.replaceChildren(
      el("p", {}, text),
      // Built again on click, so edits made after the note appeared go into the mail too.
      fallback ? el("a.btn.btn--ghost.contact__mailapp", {
        href: mailtoHref(), onclick: (e) => { e.currentTarget.href = mailtoHref(); },
      }, [icon(ICONS.mail, 18), t("contact.openMail")]) : null,
    );
    note.hidden = false;
  }

  function sending(on) {
    submitBtn.disabled = on;
    submitBtn.classList.toggle("is-busy", on);
    sendLabel.textContent = t(on ? "contact.sending" : "contact.send");
  }

  function sent(who, replyTo) {
    card.replaceChildren(el("div.contact__done", { role: "status" }, [
      el("span.contact__doneic", {}, [icon(ICONS.check, 26)]),
      el("h2", {}, t("contact.sentTitle")),
      el("p", {}, t("contact.sentBody", { name: who, email: replyTo })),
      el("button.btn.btn--ghost", { type: "button", onclick: reset }, t("contact.another")),
    ]));
  }

  function reset() {
    message.value = "";
    note.hidden = true;
    sending(false);
    card.replaceChildren(form);
    message.focus();
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.reportValidity()) return;
    note.hidden = true;
    sending(true);
    const payload = { name: name.value.trim(), email: email.value.trim(), message: message.value.trim(), website: honeypot.value };
    let res, data;
    try {
      res = await fetch(CONTACT_URL, {
        method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      data = await res.json().catch(() => ({}));
    } catch {
      sending(false);
      return showNote(t("contact.fallback"), { fallback: true });
    }
    sending(false);
    if (res.ok) return sent(payload.name, payload.email);
    // A wrong field is the visitor's to fix here; anything else (email off, the site password, the
    // daily cap, the provider down) is ours, and their own mail app still gets the message to us.
    if (res.status === 400) return showNote(serverMessage(data?.error?.message, t("login.somethingWrong")));
    showNote(t("contact.fallback"), { fallback: true });
  }

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(CONTACT_EMAIL);
      toast(t("contact.copied"));
    } catch {
      location.href = `mailto:${CONTACT_EMAIL}`;
    }
  }

  return {
    title: t("contact.pageTitle"),
    node: el("div.contact", {}, [
      homeButton({ grid: true }),
      el("div.contact__grid", {}, [
        el("div.contact__intro", {}, [
          el("div.contact__mark", { html: CARD_SVG }),
          el("h1#contact-title", {}, t("contact.pageTitle")),
          el("p.contact__lead", {}, t("contact.lead")),
          el("div.contact__direct", {}, [
            el("span.contact__directlabel", {}, t("contact.orMail")),
            el("div.contact__addr", {}, [
              el("a.contact__mail", { href: `mailto:${CONTACT_EMAIL}` }, [icon(ICONS.at, 18), el("span", {}, CONTACT_EMAIL)]),
              el("button.iconbtn.iconbtn--sm.contact__copy", {
                type: "button", onclick: copyAddress, "aria-label": t("contact.copy"), title: t("contact.copy"),
              }, [icon(ICONS.copy, 16)]),
            ]),
          ]),
        ]),
        card,
      ]),
    ]),
  };
}

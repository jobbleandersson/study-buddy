// Static informational pages: About, FAQ, Terms of Service, Privacy Policy.
// Reached from the site footer, not the main nav — read-once material,
// not something a student needs a shortcut to mid-study.

import { el } from "../lib/dom.js";
import { CONTACT_EMAIL } from "../config.js";
import { t } from "../lib/i18n.js";
import { homeButton } from "../components/nav.js";

const FEEDBACK_MAIL = `mailto:${CONTACT_EMAIL}`;

function page(titleKey, body) {
  return {
    title: t(titleKey),
    node: el("div.settings", {}, [
      homeButton({ grid: true }),
      el("h1", {}, t(titleKey)),
      ...body,
      el("a.btn.btn--ghost", { href: "#/", style: { marginTop: "8px", justifySelf: "start" } }, t("common.backToMenu")),
    ]),
  };
}

function section(headingKey, ...paragraphKeys) {
  return el("section.panel", {}, [
    el("h3", { style: { marginBottom: "8px" } }, t(headingKey)),
    ...paragraphKeys.map((k) => el("p", { style: { marginTop: "8px" } }, t(k))),
  ]);
}

function draftBanner(bodyKey) {
  return el("p.note.note--warn", { style: { marginBottom: "4px" } }, t(bodyKey));
}

export function renderAbout() {
  return page("about.pageTitle", [
    el("p.note", { style: { marginBottom: "4px" } }, t("about.heroLead")),
    section("about.missionTitle", "about.missionBody"),
    section("about.backgroundTitle", "about.backgroundBody"),
    el("section.panel", {}, [
      el("h3", { style: { marginBottom: "8px" } }, t("about.contactTitle")),
      el("p", { style: { marginTop: "8px" } }, t("about.contactBody")),
      el("a.btn.btn--ghost", { href: FEEDBACK_MAIL, style: { marginTop: "12px" } }, t("about.contactLink")),
    ]),
  ]);
}

export function renderFaq() {
  return page("faq.pageTitle", [
    section("faq.q1Title", "faq.q1Body"),
    section("faq.q2Title", "faq.q2Body"),
    section("faq.q3Title", "faq.q3Body"),
    section("faq.q4Title", "faq.q4Body"),
    section("faq.q5Title", "faq.q5Body"),
    section("faq.q6Title", "faq.q6Body"),
    section("faq.q7Title", "faq.q7Body"),
    section("faq.q8Title", "faq.q8Body"),
    el("section.panel", {}, [
      el("h3", { style: { marginBottom: "8px" } }, t("faq.q9Title")),
      el("p", { style: { marginTop: "8px" } }, t("faq.q9Body")),
      el("a.btn.btn--ghost", { href: FEEDBACK_MAIL, style: { marginTop: "12px" } }, t("about.contactLink")),
    ]),
  ]);
}

export function renderTerms() {
  return page("terms.pageTitle", [
    draftBanner("terms.draftBody"),
    section("terms.acceptTitle", "terms.acceptBody"),
    section("terms.serviceTitle", "terms.serviceBody"),
    section("terms.accountTitle", "terms.accountBody"),
    section("terms.contentTitle", "terms.contentBody"),
    section("terms.aiTitle", "terms.aiBody"),
    section("terms.warrantyTitle", "terms.warrantyBody"),
    section("terms.liabilityTitle", "terms.liabilityBody"),
    section("terms.changesTitle", "terms.changesBody"),
    section("terms.contactTitle", "terms.contactBody"),
  ]);
}

export function renderPrivacy() {
  return page("privacy.pageTitle", [
    draftBanner("privacy.draftBody"),
    section("privacy.dataTitle", "privacy.dataBody"),
    section("privacy.whoTitle", "privacy.whoBody"),
    section("privacy.useTitle", "privacy.useBody"),
    section("privacy.keepTitle", "privacy.keepBody"),
    section("privacy.cookiesTitle", "privacy.cookiesBody"),
    section("privacy.minorsTitle", "privacy.minorsBody"),
    el("section.panel", {}, [
      el("h3", { style: { marginBottom: "8px" } }, t("privacy.rightsTitle")),
      el("p", { style: { marginTop: "8px" } }, t("privacy.rightsBody")),
      el("a.btn.btn--ghost", { href: "#/settings", style: { marginTop: "12px" } }, t("privacy.rightsLink")),
    ]),
    section("privacy.contactTitle", "privacy.contactBody"),
  ]);
}

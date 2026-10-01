// The card-and-row building blocks shared by Settings, Klasser and
// Förälder / lärare, so the three pages read as one product. Styles: the
// "Settings: cards of rows" block in css/app.css (.set-*).

import { el, icon } from "../lib/dom.js";

/** One line item: its name and what it is on the left, the control(s) on the
 *  right. `stack` puts the control under the text (for wide controls); `danger`
 *  colours the name for destructive actions. `label` may be a node (a link). */
export function row(label, note, control, { stack = false, danger = false, lead = null } = {}) {
  const text = el("div.set-row__text", {}, [
    el("span.set-row__label", {}, label),
    note ? el("p.set-row__note", {}, note) : null,
  ].filter(Boolean));
  return el("div.set-row" + (stack ? ".set-row--stack" : "") + (danger ? ".set-row--danger" : ""), {}, [
    // An avatar sits right beside the name, not a column-gap away from it.
    lead ? el("div.set-row__main", {}, [lead, text]) : text,
    control ? el("div.set-row__ctl", {}, Array.isArray(control) ? control.filter(Boolean) : [control]) : null,
  ].filter(Boolean));
}

/** A section card with an icon, a title and one line on what's in it. */
export function card(iconPath, title, sub, body, { id = null } = {}) {
  return el("section.set-card", id ? { id } : {}, [
    el("header.set-card__head", {}, [
      el("span.set-card__ic", { "aria-hidden": "true" }, icon(iconPath, 18)),
      el("div", {}, [el("h2", {}, title), sub ? el("p", {}, sub) : null].filter(Boolean)),
    ]),
    ...body.filter(Boolean),
  ]);
}

/** A page head: the title and one line under it. */
export function pageHead(title, sub) {
  return el("header.settings__head", {}, [el("h1", {}, title), sub ? el("p", {}, sub) : null].filter(Boolean));
}

/** What a card says when it has nothing in it yet — an icon, a line, and
 *  optionally what to do about it. */
export function emptyState(iconPath, text, action = null) {
  return el("div.set-empty", {}, [
    el("span.set-empty__ic", { "aria-hidden": "true" }, icon(iconPath, 20)),
    el("p", {}, text),
    action,
  ].filter(Boolean));
}

/** A round badge with initials — a person (email) or a class (name). The hue
 *  comes from the text, so the same name keeps the same colour. */
export function avatar(text, { square = false } = {}) {
  const s = String(text || "?");
  const words = s.split("@")[0].split(/[\s._-]+/).filter(Boolean);
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : s.slice(0, 2)).toUpperCase();
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return el("span.set-avatar" + (square ? ".set-avatar--sq" : ""), { "aria-hidden": "true", style: { "--hue": String(h) } }, initials);
}

/** A small status label. tone: "ok" | "warn" | "brand" | undefined (neutral). */
export function chip(text, tone) {
  return el("span.set-chip" + (tone ? `.is-${tone}` : ""), {}, text);
}

/** A code input with its button beside it — class codes, invite codes. */
export function codeField(input, button) {
  input.classList.add("set-code__input");
  return el("div.set-code", {}, [input, button]);
}

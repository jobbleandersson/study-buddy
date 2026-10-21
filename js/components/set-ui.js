// The card-and-row building blocks shared by Settings, Klasser, Förälder / lärare
// and Skapa, so the pages read as one product. Styles: the "Settings: cards of
// rows" block in css/app.css (.set-*).

import { el, icon } from "../lib/dom.js";

/** An on/off switch. */
export function toggle(label, on, onChange, { disabled = false } = {}) {
  const b = el("button.set-switch", {
    type: "button", role: "switch", "aria-checked": String(!!on), "aria-label": label, disabled,
  }, [el("span.set-switch__knob")]);
  b.addEventListener("click", () => {
    const next = b.getAttribute("aria-checked") !== "true";
    b.setAttribute("aria-checked", String(next));
    onChange(next);
  });
  return b;
}

/** A short choice as segmented buttons (a radio group; arrow keys move it).
 *  `text` may be a node (the theme picker's swatches). */
export function seg(label, options, value, onChange, { cls = "set-seg", opt = "set-seg__opt" } = {}) {
  const group = el(`div.${cls}`, { role: "radiogroup", "aria-label": label });
  const btns = options.map(([v, text]) => el(`button.${opt}`, {
    type: "button", role: "radio", "aria-checked": String(v === value), tabindex: v === value ? "0" : "-1",
  }, text));
  const pick = (b, focus) => {
    btns.forEach((x) => { x.setAttribute("aria-checked", String(x === b)); x.tabIndex = x === b ? 0 : -1; });
    if (focus) b.focus();
    onChange(options[btns.indexOf(b)][0]);
  };
  btns.forEach((b, i) => {
    b.addEventListener("click", () => { if (b.getAttribute("aria-checked") !== "true") pick(b); });
    b.addEventListener("keydown", (e) => {
      const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      pick(btns[(i + step + btns.length) % btns.length], true);
    });
  });
  if (!btns.some((b) => b.tabIndex === 0) && btns[0]) btns[0].tabIndex = 0;
  group.append(...btns);
  return group;
}

/** A number with − and + beside it, kept within min..max. */
export function stepper({ label, value, min, max, step = 1, onChange }) {
  const input = el("input", { type: "number", inputmode: "numeric", min: String(min), max: String(max), "aria-label": label });
  const minus = el("button", { type: "button", "aria-label": `−${step}` }, "−");
  const plus = el("button", { type: "button", "aria-label": `+${step}` }, "+");
  const set = (raw, notify = true) => {
    const n = Math.max(min, Math.min(max, Math.round(Number(raw)) || min));
    input.value = String(n);
    minus.disabled = n <= min;
    plus.disabled = n >= max;
    if (notify) onChange(n);
  };
  minus.addEventListener("click", () => set(Number(input.value) - step));
  plus.addEventListener("click", () => set(Number(input.value) + step));
  input.addEventListener("change", () => set(input.value));
  set(value, false);
  return el("div.set-stepper", {}, [minus, input, plus]);
}

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
export function emptyState(iconPath, text, action = null, { compact = false } = {}) {
  return el("div.set-empty" + (compact ? ".set-empty--compact" : ""), {}, [
    el("span.set-empty__ic", { "aria-hidden": "true" }, icon(iconPath, 20)),
    el("p", {}, text),
    action,
  ].filter(Boolean));
}

/** A round badge with initials — a person (email) or a class (name). The hue
 *  comes from the text, so the same name keeps the same colour. */
export function avatar(text, { square = false } = {}) {
  const s = String(text || "?");
  // Letters and digits only, so a masked address ("s•••@school.se") gives "S", not "S•".
  const base = s.split("@")[0].replace(/[^\p{L}\p{N}\s._-]/gu, "");
  const words = base.split(/[\s._-]+/).filter(Boolean);
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : base.slice(0, 2) || "?").toUpperCase();
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

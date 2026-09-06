// A small "Reading" popover — theme (light / warm paper / dark), text size and
// the easy-read font, one tap from wherever it's anchored (the session header
// today). Every control writes straight through to the same localStorage the
// sidebar pickers use, so the two stay in sync; theme changes also fire
// sb:themechange, which repaints the sidebar switcher in place.

import { el } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { getTheme, setTheme } from "../lib/theme.js";
import { getFont, setFont, getTextSize, setTextSize } from "../lib/typeface.js";
import { openPopover } from "../lib/popover.js";

// "system" is a settings choice, not a reading choice — the popover offers the
// three concrete looks.
const READING_THEMES = ["light", "paper", "dark"];
const cap = (s) => s[0].toUpperCase() + s.slice(1);

export function openReadingControls(anchor) {
  const themeRow = el("div.reading__themes");
  const sizeRow = el("div.reading__row");
  const fontRow = el("div.reading__row");

  function paintThemes() {
    themeRow.replaceChildren(...READING_THEMES.map((v) => {
      const on = getTheme() === v;
      return el("button.reading__sw.reading__sw--" + v + (on ? ".is-on" : ""), {
        type: "button", "aria-pressed": String(on), title: t(`set.theme${cap(v)}`),
        onclick: () => { setTheme(v); paintThemes(); },
      }, [
        el("span.reading__chip", { "aria-hidden": "true" }),
        el("span.reading__lbl", {}, t(`set.theme${cap(v)}`)),
      ]);
    }));
  }

  function paintSize() {
    const cur = getTextSize();
    sizeRow.replaceChildren(
      el("span.reading__k", {}, t("read.textSize")),
      el("div.reading__seg", { role: "group", "aria-label": t("read.textSize") },
        [["s", "11px"], ["m", "14px"], ["l", "17px"]].map(([v, fs]) => {
          const on = cur === v;
          return el("button" + (on ? ".is-on" : ""), {
            type: "button", "aria-pressed": String(on),
            "aria-label": t(`set.textSize${cap(v)}`), style: { fontSize: fs },
            onclick: () => { setTextSize(v); paintSize(); },
          }, "A");
        })),
    );
  }

  function paintFont() {
    const on = getFont() === "hyperlegible";
    fontRow.replaceChildren(
      el("span.reading__k", {}, t("read.dyslexiaFont")),
      el("button.reading__toggle" + (on ? ".is-on" : ""), {
        type: "button", role: "switch", "aria-checked": String(on),
        "aria-label": t("read.dyslexiaFont"),
        onclick: () => { setFont(on ? "system" : "hyperlegible"); paintFont(); },
      }, el("span.reading__knob")),
    );
  }

  paintThemes(); paintSize(); paintFont();

  return openPopover(anchor, [
    el("p.reading__t", {}, t("read.title")),
    themeRow, sizeRow, fontRow,
  ], { align: "right", width: 250, role: "dialog", label: t("read.title") });
}

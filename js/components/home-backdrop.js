// The home page's background: an aura of two soft lights behind the greeting, a faint dot grid and a
// fine paper grain. Its hues follow the time of day, like the greeting above it: warm in the morning,
// blue in the day, violet in the evening, dim at night. Quiet on purpose (see css/app.css): it should be
// felt more than seen.
//
//   mountHomeBackdrop()  once, at start (main.js); CSS shows it only on the home page (body.route-home)

import { el } from "../lib/dom.js";

/** "morning" 05-12, "day" 12-18, "evening" 18-22, "night" 22-05: the greeting's hours, plus night. */
export function daypart(h = new Date().getHours()) {
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 18) return "day";
  if (h >= 18 && h < 22) return "evening";
  return "night";
}

let node = null;

export function mountHomeBackdrop() {
  if (node) return node;
  node = el("div.homebg", { "aria-hidden": "true" }, [
    el("div.homebg__light.homebg__light--a"),
    el("div.homebg__light.homebg__light--b"),
    el("div.homebg__grid"),
    el("div.homebg__grain"),
  ]);
  const paint = () => { node.dataset.daypart = daypart(); };
  paint();
  setInterval(paint, 10 * 60_000);   // a home page left open through the evening follows the clock
  document.body.prepend(node);
  return node;
}

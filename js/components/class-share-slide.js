// The full-screen "share this with your class" slide: the class name and its
// join code, big enough to read off a projector, plus a print button for a
// handout. Reuses the .modal overlay pattern (see confirm-dialog.js); the
// print rule below shows only this card when printing, the standard
// "print just this element" trick via visibility rather than display, so the
// card keeps its own layout on the page instead of collapsing to nothing.

import { el, icon, ICONS } from "../lib/dom.js";
import { t } from "../lib/i18n.js";

export function openClassShareSlide({ name, code }) {
  function close() {
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
  }
  function onKey(e) {
    if (e.key === "Escape") { e.stopPropagation(); close(); }
  }

  const overlay = el("div.modal.shareslide-modal", {
    role: "dialog", "aria-modal": "true", "aria-label": t("classes.shareTitle", { name }),
    onclick: (e) => { if (e.target === overlay) close(); },
  }, [
    el("div.modal__card.shareslide", {}, [
      el("button.iconbtn.iconbtn--sm.shareslide__close", {
        type: "button", "aria-label": t("classes.shareClose"), "data-noprint": "", onclick: close,
      }, [icon(ICONS.close, 16)]),
      el("h2.shareslide__title", {}, t("classes.shareTitle", { name })),
      el("p.shareslide__how", {}, t("classes.shareHow")),
      el("p.shareslide__code", {}, code),
      el("p.shareslide__url", { "aria-hidden": "true" }, location.host),
      el("div.shareslide__actions", { "data-noprint": "" }, [
        el("button.btn.btn--sm", { type: "button", onclick: () => window.print() }, [icon(ICONS.fileText, 16), t("classes.sharePrint")]),
      ]),
    ]),
  ]);

  document.body.appendChild(overlay);
  document.addEventListener("keydown", onKey, true);
}

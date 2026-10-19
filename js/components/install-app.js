// "Put PluggEra on your home screen." PluggEra is an installable web app (manifest.json + sw.js), but
// few students know a website can be added like an app. Where the browser offers its own install
// prompt (Chrome and Edge on Android and desktop), we keep that event and show it from our button;
// iPhone and iPad have no prompt at all, so the button opens two short steps instead (Share → Add to
// Home Screen), and so do other phone browsers. Nothing is offered once it runs as an installed app.
//
//   initInstall()     once, early (main.js): catches the browser's prompt before it's gone
//   installBanner()   the dismissible card on the home page (phones, after a first finished run)
//   installMenuItem() an entry for the "Meny" sheet; it hides itself when there's nothing to offer

import { el, icon, ICONS, toast } from "../lib/dom.js";
import { t } from "../lib/i18n.js";

const DISMISS_KEY = "studybuddy.installDismissedAt";
const INSTALLED_KEY = "studybuddy.installed";   // installed from here: the browser tab stops offering it
const DISMISS_DAYS = 30;
const CHANGE = "sb:installchange";

let deferred = null;   // the browser's beforeinstallprompt event, while it may still be shown
let bannerCard = null; // the home page's card, if one is showing

function paintBanner() {
  if (bannerCard?.isConnected === false && bannerCard.dataset.shown) { bannerCard = null; return; }
  if (!bannerCard) return;
  bannerCard.dataset.shown = "1";
  bannerCard.hidden = !canOfferInstall() || dismissedRecently();
}

export function initInstall() {
  window.addEventListener(CHANGE, paintBanner);
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();   // our own button shows it, not the browser's mini-bar
    deferred = e;
    window.dispatchEvent(new Event(CHANGE));
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    markInstalled();
    window.dispatchEvent(new Event(CHANGE));
    toast(t("install.done"));
  });
}

export function isStandalone() {
  try { return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; } catch { return false; }
}
function isIOS() {
  const ua = navigator.userAgent || "";
  return /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function isPhone() {
  try { return matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 820; } catch { return false; }
}

/** Something to offer: the browser's own prompt, or the manual steps on a phone. */
export function canOfferInstall() {
  if (isStandalone()) return false;
  if (deferred) return true;   // the browser itself says it isn't installed
  return isPhone() && !installedHere();
}

/** The button's job: the browser's prompt when there is one, else the steps for this phone. */
export async function startInstall() {
  if (deferred) {
    const e = deferred;
    deferred = null;   // a prompt can be shown once
    try {
      await e.prompt();
      const { outcome } = await e.userChoice;
      if (outcome === "accepted") markInstalled(); else rememberDismiss();
    } catch { openSteps(); }
    window.dispatchEvent(new Event(CHANGE));
    return;
  }
  openSteps();
}

function markInstalled() { try { localStorage.setItem(INSTALLED_KEY, "1"); } catch { /* private mode */ } }
function installedHere() { try { return localStorage.getItem(INSTALLED_KEY) === "1"; } catch { return false; } }
function rememberDismiss() { try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* private mode */ } }
function dismissedRecently() {
  try { return Date.now() - Number(localStorage.getItem(DISMISS_KEY) || 0) < DISMISS_DAYS * 864e5; } catch { return false; }
}

/** Two or three short steps, for a browser that can't install from a button. */
function openSteps() {
  const ios = isIOS();
  const steps = ios
    ? [[ICONS.share, t("install.iosStep1")], [ICONS.plus, t("install.iosStep2")], [ICONS.check, t("install.iosStep3")]]
    : [[ICONS.dots, t("install.otherStep1")], [ICONS.plus, t("install.otherStep2")]];
  function close() { document.removeEventListener("keydown", onKey, true); window.removeEventListener("hashchange", close); overlay.remove(); }
  function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); close(); } }
  const done = el("button.btn", { type: "button", onclick: close }, t("install.gotIt"));
  const overlay = el("div.modal.installdlg", {
    role: "dialog", "aria-modal": "true", "aria-label": t(ios ? "install.iosTitle" : "install.otherTitle"),
    onclick: (e) => { if (e.target === overlay) close(); },
  }, [
    el("div.modal__card.installdlg__card", {}, [
      el("img.installdlg__icon", { src: "assets/icon-192.png", alt: "", width: 56, height: 56 }),
      el("h3", {}, t(ios ? "install.iosTitle" : "install.otherTitle")),
      el("ol.installdlg__steps", {}, steps.map(([ic, text], i) => el("li", {}, [
        el("span.installdlg__n", { "aria-hidden": "true" }, String(i + 1)),
        el("span.installdlg__ic", { "aria-hidden": "true" }, icon(ic, 18)),
        el("span", {}, text),
      ]))),
      done,
    ]),
  ]);
  document.body.appendChild(overlay);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("hashchange", close);
  done.focus();
}

/** The home page card. It shows and hides itself as the browser's prompt arrives or the app is
 *  installed; a "Not now" keeps it away for a month on this device. */
export function installBanner() {
  const card = el("section.installcard", { hidden: true, "aria-label": t("install.title") }, [
    el("img.installcard__icon", { src: "assets/icon-192.png", alt: "", width: 44, height: 44 }),
    el("div.installcard__text", {}, [el("strong", {}, t("install.title")), el("span", {}, t("install.sub"))]),
    el("div.installcard__actions", {}, [
      el("button.btn.btn--sm", { type: "button", onclick: () => startInstall() }, t("install.cta")),
      el("button.btn.btn--ghost.btn--sm", {
        type: "button", onclick: () => { rememberDismiss(); card.hidden = true; },
      }, t("install.later")),
    ]),
  ]);
  // One card on screen at a time (the home page re-renders often), repainted by the one listener below.
  bannerCard = card;
  paintBanner();
  return card;
}

/** "Installera appen" for the Meny sheet; main.js calls refresh() each time the sheet opens. */
export function installMenuItem() {
  const item = el("button.topmenu__item", { type: "button", role: "menuitem", hidden: true, onclick: () => startInstall() },
    [icon(ICONS.download, 16), t("install.menu")]);
  item.refresh = () => { item.hidden = !canOfferInstall(); };
  return item;
}

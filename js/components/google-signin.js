// "Sign in with Google" button (Google Identity Services). The GIS script is
// only fetched when a sign-in screen actually wants the button, so nothing from
// Google loads anywhere else in the app.

import { isDark } from "../lib/theme.js";
import { getLang } from "../lib/i18n.js";

const GIS_SRC = "https://accounts.google.com/gsi/client";

let loading = null;
let initializedFor = null;
let onCredential = null;   // GIS keeps the first callback it's given, so route through a variable

function loadGis() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = GIS_SRC;
      s.async = true;
      s.onload = () => (window.google?.accounts?.id ? resolve() : reject(new Error("gis")));
      s.onerror = () => reject(new Error("gis"));
      document.head.appendChild(s);
    }).catch((e) => { loading = null; throw e; });   // allow a retry on the next visit
  }
  return loading;
}

/** Fills `box` with Google's button. `mode` is "signin" | "signup" (button wording).
 *  `handler(credential)` runs when the person picks an account. Resolves true if
 *  the button rendered, false if Google's script couldn't load (blocked, offline)
 *  — the caller then hides the whole Google section and the form still works. */
export async function renderGoogleButton(box, { clientId, mode = "signin", handler }) {
  try { await loadGis(); } catch { return false; }
  onCredential = handler;
  if (initializedFor !== clientId) {
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: (r) => onCredential?.(r.credential),
      auto_select: false,
      itp_support: true,
    });
    initializedFor = clientId;
  }
  box.textContent = "";
  const width = Math.max(200, Math.min(360, Math.round(box.getBoundingClientRect().width) || 320));
  window.google.accounts.id.renderButton(box, {
    type: "standard",
    theme: isDark() ? "filled_black" : "outline",
    size: "large",
    text: mode === "signup" ? "signup_with" : "signin_with",
    shape: "pill",
    logo_alignment: "left",
    width,
    locale: getLang() === "sv" ? "sv" : "en",
  });
  return true;
}

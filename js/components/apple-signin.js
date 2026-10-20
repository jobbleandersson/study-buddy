// "Sign in with Apple" button. Apple's script (appleid.auth.js) is only fetched when a sign-in screen wants
// the button, like google-signin.js, and runs in popup mode: the page stays put, Apple's window asks, and
// the identity token comes back to `handler(idToken)` for routes/auth.js to check. Off — no button — until
// the server has APPLE_CLIENT_ID (store.appleClientId, from /api/health).
//
// The button is drawn here, in Apple's own style (black or white, the Apple logo, Apple's wording), which
// Apple's guidelines allow instead of their script's button; that keeps it the same size as Google's.

import { el } from "../lib/dom.js";
import { t, getLang } from "../lib/i18n.js";

const sdkSrc = () => `https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/${getLang() === "sv" ? "sv_SE" : "en_US"}/appleid.auth.js`;
const APPLE_LOGO = '<svg viewBox="0 0 17 20" width="16" height="19" aria-hidden="true" focusable="false"><path fill="currentColor" d="M14.2 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.7-1-2.7-4.1zM11.6 3c.7-.9 1.2-2 1-3.2-1 0-2.3.7-3 1.6-.7.8-1.3 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.5z"/></svg>';
// Closing Apple's window is a choice, not an error worth a message.
const CANCELLED = new Set(["popup_closed_by_user", "user_cancelled_authorize", "user_trigger_new_signin_flow"]);

let loading = null;
function loadSdk() {
  if (window.AppleID?.auth) return Promise.resolve();
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = sdkSrc();
      s.async = true;
      s.onload = () => (window.AppleID?.auth ? resolve() : reject(new Error("appleid")));
      s.onerror = () => reject(new Error("appleid"));
      document.head.appendChild(s);
    }).catch((e) => { loading = null; throw e; });   // allow a retry on the next visit
  }
  return loading;
}

/** Fills `box` with the button. `mode` is "signin" | "signup" (the wording). `handler(idToken)` runs once
 *  the person has signed in with Apple; `onError()` when Apple's sign-in failed (not when they closed it).
 *  Resolves true if the button is ready, false if Apple's script couldn't load (blocked, offline) — the
 *  caller then hides the button and everything else still works. */
export async function renderAppleButton(box, { clientId, redirectUri, mode = "signin", handler, onError }) {
  try {
    await loadSdk();
    window.AppleID.auth.init({ clientId, scope: "name email", redirectURI: redirectUri || `${location.origin}/`, usePopup: true });
  } catch { return false; }
  const btn = el("button.applebtn", { type: "button" }, [
    el("span.applebtn__logo", { html: APPLE_LOGO }),
    el("span", {}, t(mode === "signup" ? "login.appleSignup" : "login.appleSignin")),
  ]);
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      const r = await window.AppleID.auth.signIn();
      const token = r?.authorization?.id_token;
      if (token) await handler(token);
      else onError?.();
    } catch (e) {
      if (!CANCELLED.has(e?.error)) onError?.();
    } finally {
      btn.disabled = false;
    }
  });
  box.replaceChildren(btn);
  return true;
}

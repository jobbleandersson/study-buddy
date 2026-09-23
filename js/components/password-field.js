// A password input with a show/hide eye button glued to its right edge. Shared by login.js
// (sign in / create account) and reset-password.js (new password after a reset link).

import { el, clear, icon, ICONS } from "../lib/dom.js";
import { t } from "../lib/i18n.js";

export function passwordField(input) {
  const btn = el("button.pwtoggle", { type: "button", "aria-label": t("login.showPassword") }, [icon(ICONS.eye, 16)]);
  btn.addEventListener("click", () => {
    const willShow = input.type === "password";
    input.type = willShow ? "text" : "password";
    clear(btn);
    btn.appendChild(icon(willShow ? ICONS.eyeOff : ICONS.eye, 16));
    btn.setAttribute("aria-label", t(willShow ? "login.hidePassword" : "login.showPassword"));
  });
  return el("div.pwfield", {}, [input, btn]);
}

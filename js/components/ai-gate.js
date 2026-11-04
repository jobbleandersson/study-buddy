// What to say where an AI feature is switched off because this month's allowance is spent. Solve, Check,
// Create, the help chat and the tutor all used to fall through to "no tutor server is connected" for that
// state, which is untrue (the server is up and the person is signed in) and leaves no way to know why the
// tutor stopped answering. store.aiBlockReason() tells the states apart; this is the "quota" wording.

import { el } from "../lib/dom.js";
import { t, getLang } from "../lib/i18n.js";
import { store } from "../store.js";

/** "1 October" / "1 oktober" for the allowance's reset moment (a ms timestamp), or "" when unknown. */
export function resetDateText(ts) {
  return ts
    ? new Date(ts).toLocaleDateString(getLang() === "sv" ? "sv-SE" : "en-GB", { day: "numeric", month: "long" })
    : "";
}

/** The warning line for the "allowance used up" state, with a way out to something that still works. When the
 *  used-up allowance is the trial of an unconfirmed address, the way out is confirming it (Settings resends the link). */
export function aiQuotaNote({ altHref = "#/library", altKey = "solve.noServerAlt", style } = {}) {
  if (store.aiUsage?.needsVerify) {
    return el("p.note.note--warn", { style }, [t("err.verifyForAi") + " ", el("a", { href: "#/settings" }, t("ai.verifyLink"))]);
  }
  return el("p.note.note--warn", { style }, [
    t("set.aiQuotaReached", { date: resetDateText(store.aiUsage?.resetsAt) }) + " ",
    el("a", { href: altHref }, t(altKey)),
  ]);
}

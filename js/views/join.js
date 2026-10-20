// #/join/class/<token> and #/join/parent/<token>: the page a shared link opens. It asks to sign in if need be (and
// brings the person back here), says plainly what accepting means, and does it on one tap. Nothing happens to
// anyone's account until they press the button: opening a link only shows what it is for.

import { store } from "../store.js";
import { el, toast, icon, ICONS } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { serverMessage } from "../lib/server-errors.js";
import { card, pageHead } from "../components/set-ui.js";
import { TOKEN_RX, joinHash, isBrokenLink } from "../lib/join-link.js";
import { CLASS_PREVIEW_URL, CLASS_JOIN_URL, LINK_PREVIEW_URL, REDEEM_CODE_URL, FRIEND_PREVIEW_URL, FRIEND_REDEEM_URL } from "../config.js";

async function post(url, token) {
  const res = await fetch(url, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(serverMessage(data?.error?.message, t("login.somethingWrong")));
    err.raw = data?.error?.message;   // the server's own words, to tell a broken link from a problem with the person
    throw err;
  }
  return data;
}

const PAGES = {
  class: {
    icon: ICONS.presentation,
    preview: CLASS_PREVIEW_URL,
    accept: CLASS_JOIN_URL,
    done: "#/classes",
    fallback: "#/classes",
  },
  parent: {
    icon: ICONS.users,
    preview: LINK_PREVIEW_URL,
    accept: REDEEM_CODE_URL,
    done: "#/parent",
    fallback: "#/parent",
  },
  friend: {
    icon: ICONS.users,
    preview: FRIEND_PREVIEW_URL,
    accept: FRIEND_REDEEM_URL,
    done: "#/leaderboard",
    fallback: "#/leaderboard",
  },
};

// What each kind of link's preview answers with: the name to show, who is asking, and whether it is already done.
const FIELDS = {
  class: (info) => ({ name: info.name, who: info.teacherName, already: info.alreadyMember }),
  parent: (info) => ({ name: info.studentName, who: info.studentName, already: false }),
  friend: (info) => ({ name: info.friendName, who: info.friendName, already: info.alreadyFriends }),
};

export function renderJoin(kind, token) {
  const page = PAGES[kind];
  const body = el("div");
  const node = el("div.settings.settings--narrow", {}, [
    pageHead(t(`join.${kind}.pageTitle`), t(`join.${kind}.pageSub`)),
    card(page.icon, t(`join.${kind}.heading`), null, [body]),
  ]);

  const note = (text, tone) => el(tone ? `p.note.note--${tone}` : "p.note", {}, text);
  const actions = (...btns) => el("div.set-inline", { style: { marginTop: "var(--s-4)" } }, btns);

  // The link can't be used. A broken link (incomplete, used up, expired) is told to ask for a new one or use a code; any
  // other reason (your own class, too many tries, the server unreachable) is just said, with a way back.
  function broken(message, raw) {
    if (!isBrokenLink(raw)) {
      body.replaceChildren(
        el("p", {}, [icon(ICONS.close, 18), " ", message || t("join.brokenTitle")]),
        actions(el("a.btn.btn--ghost.btn--sm", { href: "#/" }, t("common.backToMenu"))),
      );
      return;
    }
    body.replaceChildren(
      el("p", {}, [icon(ICONS.close, 18), " ", message || t("join.brokenTitle")]),
      note(t("join.brokenBody")),
      actions(el("a.btn.btn--ghost.btn--sm", { href: page.fallback }, t(`join.${kind}.haveCode`))),
    );
  }

  function signedOut() {
    const next = encodeURIComponent(joinHash(kind, token));
    body.replaceChildren(
      el("p", {}, t(`join.${kind}.signedOut`)),
      note(t("join.signedOutNote")),
      actions(
        el("a.btn.btn--sm", { href: `#/login?next=${next}` }, t("join.signIn")),
        el("a.btn.btn--ghost.btn--sm", { href: `#/login?next=${next}&mode=signup` }, t("join.signUp")),
      ),
    );
  }

  function ask(info) {
    const { name, who, already } = FIELDS[kind](info);
    if (already) {
      body.replaceChildren(
        el("p", {}, [icon(ICONS.check, 18), " ", t(`join.${kind}.already`, { name })]),
        actions(el("a.btn.btn--sm", { href: page.done }, t(`join.${kind}.open`))),
      );
      return;
    }
    const error = el("p.note.note--warn", { hidden: true, role: "alert" });
    const accept = el("button.btn.btn--sm", { type: "button" }, t(`join.${kind}.accept`));
    accept.addEventListener("click", async () => {
      accept.disabled = true;
      error.hidden = true;
      try {
        const result = await post(page.accept, token);
        toast(kind === "class" ? t("classes.joined", { name: result.name })
          : kind === "friend" ? t("leaderboard.addedFriend", { name: result.friendName })
          : t("parent.linkedToStudent", { email: result.studentEmail }));
        location.hash = page.done;
      } catch (e) {
        error.textContent = e.message;
        error.hidden = false;
        accept.disabled = false;
      }
    });
    body.replaceChildren(
      el("h2.set-join__title", {}, t(`join.${kind}.title`, { name, who })),
      el("p", {}, t(`join.${kind}.body`, { name, who })),
      error,
      actions(accept, el("a.btn.btn--ghost.btn--sm", { href: "#/" }, t("join.decline"))),
    );
  }

  if (!TOKEN_RX.test(token)) broken(null, "Open the link again.");
  else if (!store.authed) signedOut();
  else {
    body.replaceChildren(el("p.set-loading", {}, t("join.loading")));
    post(page.preview, token).then(ask, (e) => broken(e.message, e.raw));
  }

  return { title: t(`join.${kind}.pageTitle`), node };
}

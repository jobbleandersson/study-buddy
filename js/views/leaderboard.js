// Friend leaderboard: questions answered this week, among people you've
// added — resets weekly so it stays a live competition rather than being
// permanently led by whoever signed up first. Needs an account + the
// backend; signed-out (or no server), it's a sign-in prompt.

import { store } from "../store.js";
import { el, clear, toast, icon, ICONS } from "../lib/dom.js";
import { FRIEND_INVITE_CODE_URL, FRIEND_REDEEM_URL, FRIEND_LEADERBOARD_URL, unfriendUrl } from "../config.js";
import { shareCard, tierEmoji } from "../lib/share-card.js";
import { confirmDialog } from "../components/confirm-dialog.js";
import { homeButton } from "../components/nav.js";
import { t, plural } from "../lib/i18n.js";

async function api(url, opts) {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "content-type": "application/json" },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || t("leaderboard.requestFailed"));
  return data;
}

function signedOutNode() {
  return el("div.settings", {}, [
    homeButton({ grid: true }),
    el("h1", {}, t("leaderboard.title")),
    el("section.panel", {}, [
      el("p.note", { style: { marginBottom: "12px" } }, t("leaderboard.signInIntro")),
      store.proxyUp
        ? el("a.btn", { href: "#/login" }, t("login.signIn"))
        : el("p.note.note--warn", {}, t("leaderboard.noServer")),
    ]),
    el("a.btn.btn--ghost", { href: "#/" }, [icon(ICONS.back, 16), t("common.backToMenu")]),
  ]);
}

export function renderLeaderboard() {
  if (!store.authed) return { title: t("leaderboard.pageTitle"), node: signedOutNode() };

  const invitePanel = el("section.panel");
  const boardPanel = el("section.panel");

  function paintInvite() {
    const status = el("p.note", { style: { margin: "6px 0 12px" } }, t("leaderboard.inviteStatus"));
    const codeDisplay = el("p.lbcode", { hidden: true });
    const genBtn = el("button.btn.btn--sm", { type: "button" }, t("leaderboard.generateCode"));
    genBtn.addEventListener("click", async () => {
      genBtn.disabled = true;
      try {
        const data = await api(FRIEND_INVITE_CODE_URL, { method: "POST" });
        codeDisplay.textContent = data.code;
        codeDisplay.hidden = false;
        status.textContent = t("leaderboard.inviteGenerated");
      } catch (e) { toast(e.message); }
      genBtn.disabled = false;
    });

    const input = el("input", { type: "text", placeholder: t("leaderboard.inviteCodePlaceholder"), style: { textTransform: "uppercase" } });
    const redeemBtn = el("button.btn.btn--sm", { type: "button" }, t("leaderboard.addFriend"));
    redeemBtn.addEventListener("click", async () => {
      const code = input.value.trim();
      if (!code) return;
      redeemBtn.disabled = true;
      try {
        const data = await api(FRIEND_REDEEM_URL, { method: "POST", body: JSON.stringify({ code }) });
        toast(t("leaderboard.addedFriend", { email: data.friendEmail }));
        input.value = "";
        paintBoard();
      } catch (e) { toast(e.message); }
      redeemBtn.disabled = false;
    });

    clear(invitePanel);
    invitePanel.append(
      el("h3", { style: { marginBottom: "8px" } }, t("leaderboard.inviteHeading")),
      status, codeDisplay, genBtn,
      el("div", { style: { marginTop: "16px" } }, [
        el("label.field", { style: { marginBottom: "8px" } }, [el("span", {}, t("leaderboard.haveCode")), input]),
        redeemBtn,
      ]),
    );
  }

  async function paintBoard() {
    clear(boardPanel);
    boardPanel.append(el("h3", { style: { marginBottom: "4px" } }, t("leaderboard.boardHeading")));
    boardPanel.append(el("p.note", { style: { marginBottom: "12px" } }, t("leaderboard.boardSubtitle")));

    let data;
    try { data = await api(FRIEND_LEADERBOARD_URL); }
    catch (e) { boardPanel.append(el("p.note", {}, e.message)); return; }

    const entries = data.entries || [];
    if (entries.length <= 1) {
      boardPanel.append(el("p.note", {}, t("leaderboard.empty")));
      return;
    }

    boardPanel.append(el("div.lbrows", {}, entries.map((entry, i) => row(entry, i))));
  }

  function row(entry, i) {
    const rank = i + 1;
    const tier = rank === 1 ? "gold" : rank === 2 ? "silver" : rank === 3 ? "bronze" : null;

    const removeBtn = !entry.isMe ? el("button.iconbtn.iconbtn--sm", {
      type: "button", "aria-label": t("leaderboard.removeFriend"), title: t("leaderboard.removeFriend"),
      onclick: async () => {
        if (!(await confirmDialog({ message: t("leaderboard.removeConfirm", { email: entry.email || "?" }) }))) return;
        try { await api(unfriendUrl(entry.linkId), { method: "DELETE" }); paintBoard(); }
        catch (e) { toast(e.message); }
      },
    }, [icon(ICONS.close, 14)]) : null;

    const shareBtn = entry.isMe ? el("button.iconbtn.iconbtn--sm", {
      type: "button", "aria-label": t("share.shareButton"), title: t("share.shareButton"),
      onclick: () => shareCard({
        tone: tier || "brand",
        emoji: tier ? tierEmoji(tier) : "📈",
        tag: t("share.rankTag"),
        headline: t("share.rankHeadline", { n: rank }),
        caption: plural(entry.questionsThisWeek, "leaderboard.questionOne", "leaderboard.questionMany"),
        filename: "studybuddy-rank.png",
      }),
    }, [icon(ICONS.share, 14)]) : null;

    return el("div.lbrow" + (entry.isMe ? ".lbrow--me" : ""), {}, [
      el("span.lbrank" + (tier ? `.lbrank--${tier}` : ""), {}, String(rank)),
      el("div.lbrow__who", {}, [
        el("span.lbrow__handle", {}, entry.isMe ? t("leaderboard.you") : (entry.email ? entry.email.split("@")[0] : "?")),
        !entry.synced ? el("span.note", {}, t("leaderboard.notSyncedYet")) : null,
      ].filter(Boolean)),
      el("div.lbrow__stats", {}, [
        el("span.lbrow__streak", {}, [icon(ICONS.flame, 14), String(entry.streak)]),
        el("span.lbrow__questions", {}, plural(entry.questionsThisWeek, "leaderboard.questionOne", "leaderboard.questionMany")),
      ]),
      shareBtn,
      removeBtn,
    ].filter(Boolean));
  }

  paintInvite();
  paintBoard();

  const node = el("div.settings", {}, [
    homeButton({ grid: true }),
    el("h1", {}, t("leaderboard.title")),
    boardPanel,
    invitePanel,
    el("a.btn.btn--ghost", { href: "#/" }, [icon(ICONS.back, 16), t("common.backToMenu")]),
  ]);

  return { title: t("leaderboard.pageTitle"), node };
}

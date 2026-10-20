// Parent/teacher hub: link to students via invite code, assign one of your
// own sets to a linked student, and view a linked student's progress
// read-only — reusing the exact same pure mastery/SRS/streak functions
// #/progress runs for the signed-in user, just against a fetched blob.
//
// Built from the same cards and rows as Settings (components/set-ui.js).

import { store } from "../store.js";
import { cleanSetDoc } from "../lib/share-set.js";
import { el, toast, icon, ICONS } from "../lib/dom.js";
import { t, plural, getLang } from "../lib/i18n.js";
import { serverMessage } from "../lib/server-errors.js";
import { homeButton } from "../components/nav.js";
import { linkBox } from "../components/link-actions.js";
import { joinUrl } from "../lib/join-link.js";
import { confirmDialog } from "../components/confirm-dialog.js";
import { row, card, pageHead, emptyState, avatar, codeField } from "../components/set-ui.js";
import { signInGate, gateBar } from "../components/signin-gate.js";
import { masteryByTopic, masteryForSubject } from "../lib/mastery.js";
import { dueQuestions } from "../lib/library.js";
import { currentStreak } from "../lib/activity.js";
import {
  LINKS_URL, INVITE_CODE_URL, INVITE_LINK_URL, REDEEM_CODE_URL, ASSIGNED_FOR_ME_URL, ASSIGN_URL,
  studentStateUrl, unlinkUrl, clearAssignedUrl,
} from "../config.js";

async function api(url, opts) {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "content-type": "application/json" },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(serverMessage(data?.error?.message, t("login.somethingWrong")));
  return data;
}

function signedOutNode() {
  return el("div.settings", {}, [
    homeButton({ grid: true }),
    signInGate({
      eyebrowIcon: ICONS.users, eyebrow: t("parent.title"),
      title: t("parent.gateTitle"), lead: t("parent.gateLead"),
      points: [
        [ICONS.lock, t("parent.gateLinkHead"), t("parent.gateLinkBody")],
        [ICONS.chart, t("parent.gateSeeHead"), t("parent.gateSeeBody")],
        [ICONS.shield, t("parent.gatePrivateHead"), t("parent.gatePrivateBody")],
      ],
      preview: parentPreview(),
      next: "#/parent",
      foot: t("parent.gateStudent"),
    }),
  ]);
}

// Minutes studied Monday to Sunday in the preview; 0 is a day off.
const DEMO_WEEK = [35, 50, 0, 70, 45, 0, 25];

/** The signed-out preview: a made-up linked student as the progress page
 *  shows them — the week, each subject (weakest first) and what's due. */
function parentPreview() {
  // 1 Jan 2024 was a Monday, so these give the week's day letters in the app's language.
  const day = new Intl.DateTimeFormat(getLang() === "sv" ? "sv-SE" : "en-GB", { weekday: "narrow" });
  const max = Math.max(...DEMO_WEEK);
  return el("div.gart", {}, [
    el("div.gart__head", {}, [
      avatar(t("parent.demoName")),
      el("div.gart__who", {}, [el("strong", {}, t("parent.demoName")), el("span", {}, t("parent.studentNote"))]),
      el("span.gart__streak", {}, [icon(ICONS.flame, 14), t("parent.streakDays", { n: 6 })]),
    ]),
    el("div.gart__box", {}, [
      el("p.gart__label", {}, t("parent.demoWeek")),
      el("div.gart__week", {}, DEMO_WEEK.map((m, i) => el("span.gart__day" + (m ? "" : ".is-off"), {}, [
        el("span", {}, [el("i", { style: { height: `${m ? Math.round((m / max) * 100) : 8}%` } })]),
        el("small", {}, day.format(new Date(2024, 0, 1 + i))),
      ]))),
    ]),
    el("div.gart__box", {}, [
      el("p.gart__label", {}, t("parent.masteryHeading")),
      ...[["parent.demoSubj1", 41, "warn"], ["parent.demoSubj2", 64, ""], ["parent.demoSubj3", 82, "ok"]].map(([k, pct, tone]) =>
        el("div.gart__subj", {}, [el("span", {}, t(k)), gateBar(pct, tone), el("b", {}, `${pct} %`)])),
    ]),
    el("p.gart__due", {}, [icon(ICONS.clock, 14), t("parent.dueMany", { n: 12 })]),
  ]);
}

const loading = () => el("p.set-loading", {}, t("parent.loading"));

function unlinkButton(link, email, after) {
  return el("button.btn.btn--ghost.btn--sm.set-danger", {
    type: "button",
    onclick: async () => {
      if (!(await confirmDialog({ message: t("parent.unlinkConfirm", { email }), confirmLabel: t("parent.unlink"), danger: true }))) return;
      try { await api(unlinkUrl(link.linkId), { method: "DELETE" }); after(); }
      catch (e) { toast(e.message); }
    },
  }, t("parent.unlink"));
}

// ---------- hub: /parent ----------

export function renderParentHub() {
  if (!store.authed) return { title: t("parent.title"), node: signedOutNode() };

  const studentsBody = el("div", {}, [loading()]);
  const parentsBody = el("div", {}, [loading()]);
  const assignedBody = el("div", {}, [loading()]);
  const inviteBody = el("div");
  const linkBody = el("div");

  async function refreshLinks() {
    let data;
    try { data = await api(LINKS_URL); }
    catch (e) {
      toast(e.message);
      studentsBody.replaceChildren(emptyState(ICONS.close, t("parent.loadFail")), redeemRow());
      parentsBody.replaceChildren(emptyState(ICONS.close, t("parent.loadFail")));
      return;
    }
    paintStudents(data.asParent);
    paintParents(data.asStudent);
  }

  function paintStudents(list) {
    studentsBody.replaceChildren(...[
      list.length
        ? el("div.set-list", {}, list.map(studentRow))
        : emptyState(ICONS.users, t("parent.studentsNone")),
      redeemRow(),
    ]);
  }

  function studentRow(link) {
    const picker = el("div.set-subpanel", { hidden: true });
    const assignBtn = el("button.btn.btn--ghost.btn--sm", { type: "button", "aria-expanded": "false" }, t("parent.assignSet"));
    assignBtn.addEventListener("click", () => {
      const opening = picker.hidden;
      picker.hidden = !opening;
      assignBtn.setAttribute("aria-expanded", String(opening));
      if (opening && !picker.childNodes.length) picker.append(...assignPicker(link));
    });
    return el("div.set-group", {}, [
      row(
        el("a.set-row__link", { href: `#/parent/${link.studentUserId}` }, link.studentEmail),
        t("parent.studentNote"),
        [
          el("a.btn.btn--sm", { href: `#/parent/${link.studentUserId}` }, [icon(ICONS.chart, 15), t("parent.viewProgress")]),
          assignBtn,
          unlinkButton(link, link.studentEmail, refreshLinks),
        ],
        { lead: avatar(link.studentEmail) },
      ),
      picker,
    ]);
  }

  function assignPicker(link) {
    if (!store.assignments.length) {
      return [el("p.set-row__note", {}, t("parent.noOwnSets"))];
    }
    const sel = el("select", { "aria-label": t("parent.assignSet") }, store.assignments.map((a) =>
      el("option", { value: a.id }, `${a.title} (${plural(a.questions.length, "common.questionOne", "common.questionMany")})`)));
    const btn = el("button.btn.btn--sm", { type: "button" }, t("parent.assign"));
    btn.addEventListener("click", async () => {
      const a = store.getAssignment(sel.value);
      if (!a) return;
      const doc = {
        title: a.title,
        subject: store.subjects.find((s) => s.id === a.subjectId)?.name || t("common.general"),
        questions: a.questions,
      };
      btn.disabled = true;
      try {
        await api(ASSIGN_URL, { method: "POST", body: JSON.stringify({ studentUserId: link.studentUserId, doc }) });
        toast(t("parent.assigned", { title: a.title, email: link.studentEmail }));
      } catch (e) { toast(e.message); }
      btn.disabled = false;
    });
    return [el("div.set-inline", {}, [sel, btn])];
  }

  function redeemRow() {
    const input = el("input", {
      type: "text", autocomplete: "off", spellcheck: "false",
      placeholder: t("parent.codePlaceholder"), "aria-label": t("parent.haveCode"),
    });
    const btn = el("button.btn.btn--sm", { type: "button" }, t("parent.link"));
    btn.addEventListener("click", async () => {
      const code = input.value.trim();
      if (!code) { input.focus(); return; }
      btn.disabled = true;
      try {
        const data = await api(REDEEM_CODE_URL, { method: "POST", body: JSON.stringify({ code }) });
        toast(t("parent.linkedToStudent", { email: data.studentEmail }));
        input.value = "";
        refreshLinks();
      } catch (e) { toast(e.message); }
      btn.disabled = false;
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") btn.click(); });
    return row(t("parent.haveCode"), t("parent.haveCodeNote"), codeField(input, btn));
  }

  function paintParents(list) {
    parentsBody.replaceChildren(list.length
      ? el("div.set-list", {}, list.map((link) =>
          row(link.parentEmail, t("parent.parentNote"), unlinkButton(link, link.parentEmail, refreshLinks), { lead: avatar(link.parentEmail) })))
      : emptyState(ICONS.user, t("parent.parentsNone")));
  }

  async function paintAssigned() {
    let list;
    try { list = await api(ASSIGNED_FOR_ME_URL); }
    catch { assignedBody.replaceChildren(emptyState(ICONS.close, t("parent.assignedLoadFail"))); return; }

    if (!list.length) { assignedBody.replaceChildren(emptyState(ICONS.check, t("parent.assignedNone"))); return; }
    assignedBody.replaceChildren(el("div.set-list", {}, list.map((item) => {
      const btn = el("button.btn.btn--sm", { type: "button" }, [icon(ICONS.plus, 15), t("parent.addToLibrary")]);
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        // Clear it on the server first: if that fails, the item would reappear
        // on the next load and a second click would add a duplicate.
        try { await api(clearAssignedUrl(item.id), { method: "DELETE" }); }
        catch { btn.disabled = false; toast(t("parent.addToLibraryFail")); return; }
        // Whatever the other account sent, checked like a shared file before it joins this library.
        const doc = cleanSetDoc(item.doc);
        if (!doc) { toast(t("share.setBad")); paintAssigned(); return; }
        store.addAssignmentDoc(doc);
        toast(t("parent.addedToLibrary", { title: doc.title }));
        paintAssigned();
      });
      return row(item.doc.title, t("parent.fromWho", { email: item.assignedByEmail }), btn, { lead: avatar(item.assignedByEmail) });
    })));
  }

  function paintInvite() {
    const btn = el("button.btn.btn--sm", { type: "button" }, [icon(ICONS.plus, 15), t("parent.inviteGenerate")]);
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        const data = await api(INVITE_CODE_URL, { method: "POST" });
        showCode(data.code);
      } catch (e) { toast(e.message); btn.disabled = false; }
    });
    inviteBody.replaceChildren(row(t("parent.inviteCodeLabel"), t("parent.inviteIntro"), btn));
  }

  function showCode(code) {
    const copy = el("button.btn.btn--ghost.btn--sm", { type: "button" }, [icon(ICONS.copy, 15), t("classes.copyCode")]);
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(code); toast(t("classes.codeCopied")); } catch { /* it's on screen to read out */ }
    });
    const again = el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: paintInvite }, t("parent.inviteNew"));
    inviteBody.replaceChildren(
      el("div.set-bigcode", {}, [
        el("span.set-bigcode__code", { "aria-label": code.split("").join(" ") }, code),
        el("div.set-row__ctl", {}, [copy, again]),
      ]),
      el("p.set-bigcode__note", {}, t("parent.inviteShare")),
    );
  }

  // The same invitation as a link, for sending in a message: the parent taps it and confirms (views/join.js).
  function paintInviteLink() {
    const btn = el("button.btn.btn--sm", { type: "button" }, [icon(ICONS.share, 15), t("join.parentLinkCreate")]);
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        const data = await api(INVITE_LINK_URL, { method: "POST" });
        // The row keeps its heading; the link sits under it, with what to know about it.
        linkBody.replaceChildren(
          row(t("join.parentLinkLabel"), t("join.parentLinkNote")),
          linkBox(joinUrl("parent", data.token), { title: t("join.parentShareTitle"), text: t("join.parentShareText") }),
        );
      } catch (e) { toast(e.message); btn.disabled = false; }
    });
    linkBody.replaceChildren(row(t("join.parentLinkLabel"), t("join.parentLinkIntro"), btn));
  }

  refreshLinks();
  paintAssigned();
  paintInvite();
  paintInviteLink();
  // The list changes from other tabs and devices (a link made, a student who unlinked): look again when this tab
  // comes back into view, and stop once the screen has been left.
  const onBack = () => {
    if (!document.getElementById("app")?.contains(node)) { document.removeEventListener("visibilitychange", onBack); window.removeEventListener("focus", onBack); return; }
    if (document.visibilityState === "visible") refreshLinks();
  };
  document.addEventListener("visibilitychange", onBack);
  window.addEventListener("focus", onBack);

  const node = el("div.settings.settings--narrow", {}, [
    homeButton({ grid: true }),
    pageHead(t("parent.title"), t("parent.pageSub")),
    card(ICONS.share, t("parent.inviteHeading"), t("parent.inviteSub"), [inviteBody, linkBody]),
    card(ICONS.users, t("parent.studentsHeading"), t("parent.studentsSub"), [studentsBody]),
    card(ICONS.user, t("parent.parentsHeading"), t("parent.parentsSub"), [parentsBody]),
    card(ICONS.clipboard, t("parent.assignedToYouHeading"), t("parent.assignedSub"), [assignedBody]),
  ]);

  return { title: t("parent.title"), node };
}

// ---------- per-student read-only detail: /parent/:studentId ----------

export async function renderParentStudent(studentUserId) {
  if (!store.authed) return { title: t("parent.title"), node: signedOutNode() };

  const back = el("a.btn.btn--ghost.btn--sm.set-back", { href: "#/parent" }, [icon(ICONS.back, 16), t("parent.back")]);
  let blob, email = null;
  try {
    // The links list carries the student's email for the heading; best-effort.
    const [data, links] = await Promise.all([
      api(studentStateUrl(studentUserId)),
      api(LINKS_URL).catch(() => null),
    ]);
    blob = data.blob;
    email = links?.asParent?.find((l) => l.studentUserId === studentUserId)?.studentEmail || null;
  } catch (e) {
    return {
      title: t("parent.title"),
      node: el("div.settings.settings--narrow", {}, [
        back,
        pageHead(t("parent.notAvailable"), null),
        card(ICONS.close, t("parent.notAvailable"), null, [el("p.set-loading", {}, e.message)]),
      ]),
    };
  }

  if (!blob) {
    return {
      title: t("parent.title"),
      node: el("div.settings.settings--narrow", {}, [
        back,
        pageHead(t("parent.studentProgressTitle"), email),
        card(ICONS.chart, t("parent.noDataTitle"), null, [emptyState(ICONS.chart, t("parent.noDataBody"))]),
      ]),
    };
  }

  const tm = masteryByTopic(blob.attempts || []);
  const streak = currentStreak(blob.activity?.daysStudied || [], blob.activity?.frozenDays || []);
  const due = dueQuestions(blob.assignments || [], blob.srs || {});
  const days = (blob.activity?.daysStudied || []).length;
  const sessions = (blob.attempts || []).length;

  const meters = (blob.subjects || [])
    .map((s) => ({ s, m: masteryForSubject(s.id, blob.assignments || [], tm) }))
    .filter((x) => x.m != null)
    .sort((a, b) => a.m - b.m)
    .map(({ s, m }) => {
      const pct = Math.round(m * 100);
      return el("div.meter", {}, [
        el("span", {}, s.name),
        el("div.meter__track", { role: "img", "aria-label": `${s.name}: ${pct}%` },
          [el("div.meter__fill", { style: { width: `${pct}%` } })]),
        el("span.tabular", { style: { textAlign: "right", fontWeight: 700 } }, `${pct}%`),
      ]);
    });

  // Answers the student marked correct on appeal, last ~20 sessions —
  // so an appeal-heavy score reads honestly here.
  const appealed = (blob.attempts || []).slice(-20)
    .reduce((n, a) => n + (a.items || []).filter((i) => i.appealed).length, 0);

  const stat = (iconPath, value, label) => el("div.set-stat", {}, [
    el("span.set-stat__ic", { "aria-hidden": "true" }, icon(iconPath, 18)),
    el("b", {}, value),
    el("span", {}, label),
  ]);

  const node = el("div.settings.settings--narrow", {}, [
    back,
    pageHead(t("parent.studentProgressTitle"), email),
    card(ICONS.flame, t("parent.overviewHeading"), t("parent.overviewSub"), [
      el("div.set-stats", {}, [
        stat(ICONS.flame, plural(streak, "parent.streakDay", "parent.streakDays"), t("parent.studyStreak")),
        stat(ICONS.calendar, String(days), t("parent.statDays")),
        stat(ICONS.check, String(sessions), t("parent.statSessions")),
      ]),
      appealed ? el("p.set-card__foot", {}, t("parent.appealed", { n: appealed })) : null,
    ]),
    card(ICONS.chart, t("parent.masteryHeading"), t("parent.masterySub"), [
      meters.length ? el("div.set-meters", {}, meters) : emptyState(ICONS.chart, t("parent.noMastery")),
    ]),
    card(ICONS.clock, t("parent.dueHeading"), null, [
      due.length
        ? row(plural(due.length, "parent.dueOne", "parent.dueMany"), t("parent.dueNote"), null)
        : emptyState(ICONS.check, t("parent.dueNone")),
    ]),
  ]);

  return { title: t("parent.studentProgressTitle"), node };
}

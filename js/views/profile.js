// #/profile — "Min profil". The student as PluggEra knows them: a student card at the top (their
// picture where an ID photo would be, name, level, goal and how long they've studied here, with their
// record along its foot), then their subjects, latest trophies and account. "Edit profile" changes
// the picture, name, role, level and goal: the same answers the welcome quiz asks for, kept in
// store.profile, so there is one place for them, not two.

import { store } from "../store.js";
import { el, icon, ICONS, toast } from "../lib/dom.js";
import { t, plural, getLang, fmtDecimal, fmtDate, daysUntil } from "../lib/i18n.js";
import { homeButton } from "../components/nav.js";
import { card, row, emptyState } from "../components/set-ui.js";
import { openAvatarEditor } from "../components/avatar-editor.js";
import { cleanName, LEVELS, GOALS } from "../components/onboarding.js";
import { ACHIEVEMENTS, TIER_NAMES, nextAchievement } from "../lib/achievements.js";
import { masteryByTopic, masteryForSubject } from "../lib/mastery.js";
import { estimatedGrade } from "../lib/grade.js";
import { isHpSetId } from "../lib/hp.js";
import { hpPrognosis } from "./hp.js";

const ROLES = ["student", "parent", "teacher"];
const SUBJECTS_SHOWN = 6;
const TROPHIES_SHOWN = 4;

/** Pick a picture, frame it in the avatar editor and save it. Resolves true once one is saved. */
function pickAvatar() {
  return new Promise((resolve) => {
    const input = el("input", { type: "file", accept: "image/*", hidden: true });
    input.addEventListener("cancel", () => { input.remove(); resolve(false); });
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return resolve(false);
      const res = await openAvatarEditor(file);
      if (!res) return resolve(false);                    // cancelled
      if (res.error) { toast(res.error); return resolve(false); }
      if (!store.setAvatar(res.dataUrl)) { toast(t("avatar.readFail")); return resolve(false); }
      toast(t("avatar.saved"));
      resolve(true);
    });
    document.body.appendChild(input);
    input.click();
  });
}

/** When the student started here: the earliest of the quiz, a set and a run. */
function studyingSince() {
  const times = [
    store.profile?.completedAt,
    ...store.assignments.map((a) => a.createdAt),
    ...store.attempts.map((a) => a.startedAt || a.finishedAt),
  ].filter((n) => Number.isFinite(n) && n > 0);
  return times.length ? Math.min(...times) : null;
}

function monthYear(ms) {
  try {
    return new Intl.DateTimeFormat(getLang() === "sv" ? "sv-SE" : "en-GB", { month: "long", year: "numeric" }).format(new Date(ms));
  } catch { return ""; }
}

function shortDate(ms) {
  try {
    return new Intl.DateTimeFormat(getLang() === "sv" ? "sv-SE" : "en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(ms));
  } catch { return ""; }
}

export function renderProfile() {
  const p = store.profile || {};
  const role = ROLES.includes(p.role) ? p.role : "student";
  const node = el("div.profile", {}, [
    homeButton({ grid: true }),
    el("h1.profile__title", {}, t("profile.title")),
    studentCard(p, role),
    el("div.profile__grid", {}, [subjectsCard(), trophiesCard()]),
    accountCard(),
  ]);

  requestAnimationFrame(() => {
    node.querySelectorAll("[data-w]").forEach((i) => { i.style.width = `${i.dataset.w}%`; });
  });
  return { title: t("profile.title"), node };
}

/* ---------------- the student card ---------------- */

function studentCard(p, role) {
  const name = cleanName(p.name);
  const student = role === "student";
  const hpDate = store.settings.hpDate;
  const a = store.avatar;

  const photo = el("button.idcard__photo", {
    type: "button", onclick: pickAvatar,
    "aria-label": t(a ? "avatar.change" : "avatar.add"), title: t(a ? "avatar.change" : "avatar.add"),
  }, [
    a ? el("img", { src: a, alt: "" })
      : name ? el("span.idcard__initial", { "aria-hidden": "true" }, name[0].toUpperCase())
      : icon(ICONS.user, 40),
    el("span.idcard__cam", { "aria-hidden": "true" }, icon(ICONS.camera, 15)),
  ]);

  const tag = (iconPath, text) => el("span.idcard__tag", {}, [icon(iconPath, 14), text]);
  const tags = student
    ? [
        p.level && LEVELS.includes(p.level) ? tag(ICONS.graduation, t(`welcome.level.${p.level}`)) : null,
        p.goal && GOALS.some(([g]) => g === p.goal) ? tag(ICONS.target, t(`welcome.goal.${p.goal}`)) : null,
        p.goal === "hp" && hpDate && daysUntil(hpDate) >= 0 ? tag(ICONS.calendar, t("profile.hpDay", { date: fmtDate(hpDate) })) : null,
      ].filter(Boolean)
    : [tag(role === "parent" ? ICONS.users : ICONS.presentation, t(`profile.role.${role}`))];

  const since = studyingSince();
  const { displayStreak } = store.streakInfo;
  const answered = store.attempts.reduce((n, at) => n + (at.items?.length || 0), 0);
  const days = store.state.activity.daysStudied.length;
  const unlocked = store.unlockedAchievements || {};
  const got = ACHIEVEMENTS.filter((d) => d.id in unlocked).length;
  const nf = new Intl.NumberFormat(getLang() === "sv" ? "sv-SE" : "en-GB");
  const stat = (value, label) => el("div.idcard__stat", {}, [el("strong", {}, value), el("span", {}, label)]);

  return el("section.idcard", { "aria-label": t("profile.cardAria") }, [
    el("div.idcard__top", {}, [
      el("span.idcard__brand", {}, [el("img", { src: "assets/favicon.svg", alt: "" }), el("span.wordmark__text", {}, "PluggEra")]),
      el("button.idcard__edit", { type: "button", onclick: () => openProfileEditor() }, [icon(ICONS.pencil, 15), t("profile.edit")]),
    ]),
    el("div.idcard__who", {}, [
      photo,
      el("div.idcard__id", {}, [
        name
          ? el("h2.idcard__name", {}, name)
          : el("button.idcard__addname", { type: "button", onclick: () => openProfileEditor({ focusName: true }) }, t("profile.addName")),
        store.authed && store.authEmail ? el("p.idcard__mail", {}, store.authEmail) : null,
        tags.length ? el("div.idcard__tags", {}, tags) : null,
        since ? el("p.idcard__since", {}, t("profile.since", { when: monthYear(since) })) : null,
      ].filter(Boolean)),
    ]),
    el("div.idcard__stats", {}, [
      stat(nf.format(displayStreak), plural(displayStreak, "profile.statStreakOne", "profile.statStreakMany")),
      stat(nf.format(answered), plural(answered, "profile.statAnsweredOne", "profile.statAnsweredMany")),
      stat(nf.format(days), plural(days, "profile.statDaysOne", "profile.statDaysMany")),
      stat(`${got}`, t("profile.statTrophies", { total: ACHIEVEMENTS.length })),
    ]),
  ]);
}

/* ---------------- subjects ---------------- */

function subjectsCard() {
  const tm = masteryByTopic(store.attempts);
  // Högskoleprovet has its own 0–2.0 scale (the row under the list), not an E–A level.
  const hpSubjects = new Set(store.assignments.filter((a) => isHpSetId(a.id)).map((a) => a.subjectId));
  const rows = store.subjects
    .filter((s) => !hpSubjects.has(s.id))
    .map((s) => ({ s, m: masteryForSubject(s.id, store.assignments, tm) }))
    .filter((x) => x.m != null)
    .sort((x, y) => y.m - x.m);

  const list = rows.length ? el("ul.profile-subjs", {}, rows.slice(0, SUBJECTS_SHOWN).map(({ s, m }) => {
    const color = store.subjectColor(s.id);
    const pct = Math.round(m * 100);
    const grade = estimatedGrade(m);
    return el("li.profile-subj", { style: { "--subject": color.solid } }, [
      el("span.profile-subj__dot", { "aria-hidden": "true" }),
      el("span.profile-subj__name", {}, s.name),
      el("span.profile-subj__bar", { role: "img", "aria-label": t("prog.masteryAria", { subject: s.name, pct }) },
        [el("i", { style: { width: "0%" }, dataset: { w: pct } })]),
      el(`span.gradepill.gradepill--${grade.tier}`, { title: t("prog.gradeTooltip", { letter: grade.letter }) }, grade.letter),
    ]);
  })) : emptyState(ICONS.graduation, t("profile.subjectsEmpty"),
    el("a.btn.btn--sm", { href: "#/library" }, t("profile.subjectsCta")));

  const hp = hpPrognosis();
  const hpRow = hp && hp.total != null ? el("a.profile-hp", { href: "#/hp" }, [
    el("span.profile-hp__ic", { "aria-hidden": "true" }, icon(ICONS.award, 18)),
    el("span.profile-hp__text", {}, [el("strong", {}, t("profile.hpLabel")), el("small", {}, t("profile.hpScore"))]),
    el("span.profile-hp__score", {}, fmtDecimal(hp.total, 2)),
  ]) : null;

  return card(ICONS.graduation, t("profile.subjectsTitle"), rows.length ? t("profile.subjectsSub") : null, [
    list,
    hpRow,
    rows.length ? el("p.profile-more", {}, el("a.linkbtn", { href: "#/progress" }, [t("profile.seeProgress"), icon(ICONS.arrow, 14)])) : null,
  ]);
}

/* ---------------- trophies ---------------- */

function trophiesCard() {
  const unlocked = store.unlockedAchievements || {};
  const got = ACHIEVEMENTS.filter((d) => d.id in unlocked);
  // Newest first, one per track (its highest tier: silver says more than the bronze under it).
  const rank = (d) => TIER_NAMES.indexOf(d.tier);
  const seen = new Set();
  const latest = [...got]
    .sort((x, y) => (unlocked[y.id] || 0) - (unlocked[x.id] || 0) || rank(y) - rank(x))
    .filter((d) => !d.track || (!seen.has(d.track) && seen.add(d.track)))
    .slice(0, TROPHIES_SHOWN);

  let body;
  if (latest.length) {
    body = el("ul.profile-trophies", {}, latest.map((d) => {
      const stamp = unlocked[d.id];
      const tone = d.track ? d.tier : "milestone";
      return el(`li.profile-trophy.profile-trophy--${tone}`, {}, [
        el("span.profile-trophy__medal", { "aria-hidden": "true" }, icon(ICONS[d.icon] || ICONS.award, 18)),
        el("span.profile-trophy__text", {}, [
          el("strong", {}, t(d.nameKey)),
          el("small", {}, [
            el("span.profile-trophy__tier", {}, t(`ach.tier.${tone}`)),
            stamp ? el("span", {}, shortDate(stamp)) : null,
          ].filter(Boolean)),
        ]),
      ]);
    }));
  } else {
    const next = nextAchievement(store.state);
    body = emptyState(ICONS.trophy, next
      ? t("profile.trophiesNone", { desc: t(next.def.descKey, { n: next.def.target }), have: next.have, need: next.need })
      : t("profile.trophiesNoneAll"));
  }

  return card(ICONS.trophy, t("profile.trophiesTitle"), t("profile.trophiesSub", { got: got.length, total: ACHIEVEMENTS.length }), [
    body,
    el("p.profile-more", {}, el("a.linkbtn", { href: "#/achievements" }, [t("profile.trophiesAll"), icon(ICONS.arrow, 14)])),
  ]);
}

/* ---------------- account ---------------- */

function accountCard() {
  if (!store.authed) {
    return card(ICONS.user, t("profile.accountTitle"), t("profile.accountLocalSub"), [
      row(t("account.signIn"), t("profile.signInNote"), el("a.btn.btn--sm", { href: "#/login" }, t("set.acctSignIn"))),
      row(t("profile.accountSettings"), null, el("a.btn.btn--ghost.btn--sm", { href: "#/settings" }, t("account.settings"))),
    ]);
  }
  return card(ICONS.user, t("profile.accountTitle"), t("profile.accountSub"), [
    row(t("profile.accountSettings"), t("profile.accountSettingsNote"),
      el("a.btn.btn--ghost.btn--sm", { href: "#/settings" }, [icon(ICONS.gear, 15), t("account.settings")])),
    row(t("profile.email"), store.authEmail || "", el("button.btn.btn--ghost.btn--sm.profile-signout", {
      type: "button",
      onclick: async () => {
        let r = null;
        try { r = await store.logout(); } catch {}
        toast(t(r?.kept ? "set.acctSignedOutKept" : "account.signOutDone"));
        location.hash = "#/";
      },
    }, [icon(ICONS.logout, 15), t("account.signOut")])),
  ]);
}

/* ---------------- edit ---------------- */

let editorOpen = false;

/** The edit dialog: picture, first name, role, and for a student their level, goal and (for
 *  Högskoleprovet) test day. Nothing is saved until "Save changes". */
export function openProfileEditor({ focusName = false } = {}) {
  if (editorOpen) return;
  editorOpen = true;
  const opener = document.activeElement;
  const p = store.profile || {};
  const draft = {
    name: cleanName(p.name),
    role: ROLES.includes(p.role) ? p.role : "student",
    level: LEVELS.includes(p.level) ? p.level : null,
    goal: GOALS.some(([g]) => g === p.goal) ? p.goal : null,
    hpDate: store.settings.hpDate || "",
  };

  const nameInput = el("input#profile-name", {
    type: "text", maxlength: "24", autocomplete: "given-name", placeholder: t("profile.namePlaceholder"), value: draft.name,
    oninput: (e) => { draft.name = e.target.value; },
  });
  const face = el("span.profile-edit__face");
  const photoActs = el("div.profile-edit__photoacts");
  const studentPart = el("div.profile-edit__student");
  const box = el("div.modal__card.profile-edit", { tabindex: "-1" }, [
    el("h2", { id: "profile-edit-title" }, t("profile.editTitle")),
    el("div.profile-edit__photo", {}, [face, el("div", {}, [el("p.profile-edit__label", {}, t("profile.photo")), photoActs])]),
    el("label.field", {}, [el("span", {}, t("profile.nameLabel")), nameInput, el("small.note", {}, t("profile.nameNote"))]),
    choiceGroup(t("profile.roleLabel"), ROLES, (k) => t(`profile.role.${k}`), () => draft.role, (k) => { draft.role = k; paint(); }),
    studentPart,
    el("div.profile-edit__actions", {}, [
      el("button.btn.btn--ghost", { type: "button", onclick: () => close() }, t("common.cancel")),
      el("button.btn", { type: "button", onclick: save }, t("profile.save")),
    ]),
  ]);
  const overlay = el("div.modal", {
    role: "dialog", "aria-modal": "true", "aria-labelledby": "profile-edit-title",
    onclick: (e) => { if (e.target === overlay) close(); },
  }, [box]);

  function paintFace() {
    const a = store.avatar;
    const initial = cleanName(draft.name)[0];
    face.replaceChildren(a ? el("img", { src: a, alt: "" }) : initial ? el("span", {}, initial.toUpperCase()) : icon(ICONS.user, 26));
    photoActs.replaceChildren(...[
      el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: async () => { if (await pickAvatar()) paintFace(); } },
        [icon(ICONS.camera, 15), t(a ? "avatar.change" : "avatar.add")]),
      a ? el("button.btn.btn--ghost.btn--sm", {
        type: "button",
        onclick: () => {
          store.setAvatar(null);
          paintFace();
          toast(t("avatar.removed"), { actionLabel: t("common.undo"), onAction: () => { store.setAvatar(a); paintFace(); } });
        },
      }, t("avatar.remove")) : null,
    ].filter(Boolean));
  }

  /** Level, goal and test day only mean something for a student. */
  function paint() {
    box.querySelectorAll("[data-group]").forEach((g) => g.querySelectorAll(".chip").forEach((c) => {
      c.setAttribute("aria-pressed", String(c.dataset.key === draft[g.dataset.group])); }));
    studentPart.replaceChildren(...(draft.role !== "student" ? [] : [
      choiceGroup(t("profile.levelLabel"), LEVELS, (k) => t(`welcome.level.${k}`), () => draft.level, (k) => { draft.level = k; paint(); }, "level"),
      choiceGroup(t("profile.goalLabel"), GOALS.map(([g]) => g), (k) => t(`welcome.goal.${k}`), () => draft.goal, (k) => { draft.goal = k; paint(); }, "goal"),
      draft.goal === "hp" ? el("label.field", {}, [
        el("span", {}, t("profile.hpDateLabel")),
        el("input", { type: "date", value: draft.hpDate, oninput: (e) => { draft.hpDate = e.target.value; } }),
      ]) : null,
    ].filter(Boolean)));
  }

  function save() {
    const name = cleanName(draft.name);
    const student = draft.role === "student";
    store.saveProfile({
      name, role: draft.role,
      ...(student ? { level: draft.level, goal: draft.goal } : {}),
      ...(student && draft.goal === "hp" ? { testDate: draft.hpDate } : {}),
    });
    if (student && draft.goal === "hp" && draft.hpDate !== (store.settings.hpDate || "")) store.setHpDate(draft.hpDate || null);
    close();
    toast(t("profile.saved"));
  }

  function close() {
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("hashchange", close);
    overlay.remove();
    editorOpen = false;
    if (opener?.isConnected) opener.focus();
  }
  function onKey(e) {
    if (document.querySelector(".avatared")) return;   // the picture editor on top owns its keys
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
  }

  paintFace();
  paint();
  document.body.appendChild(overlay);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("hashchange", close);
  (focusName ? nameInput : box).focus();
}

/** A row of single-choice chips under a legend. `group` names the draft field it sets, so a repaint
 *  can move the pressed state without rebuilding it. */
function choiceGroup(legend, keys, label, current, pick, group = "role") {
  return el("fieldset.profile-edit__group", { dataset: { group } }, [
    el("legend", {}, legend),
    el("div.chips", {}, keys.map((k) => el("button.chip", {
      type: "button", "aria-pressed": String(current() === k), dataset: { key: k }, onclick: () => pick(k),
    }, label(k)))),
  ]);
}

// Parent/teacher hub: link to students via invite code, assign one of your
// own sets to a linked student, and view a linked student's progress
// read-only — reusing the exact same pure mastery/SRS/streak functions
// #/progress runs for the signed-in user, just against a fetched blob.

import { store } from "../store.js";
import { el, clear, toast, icon, ICONS } from "../lib/dom.js";
import { t, plural } from "../lib/i18n.js";
import { masteryByTopic, masteryForSubject } from "../lib/mastery.js";
import { dueQuestions } from "../lib/library.js";
import { currentStreak } from "../lib/activity.js";
import {
  LINKS_URL, INVITE_CODE_URL, REDEEM_CODE_URL, ASSIGNED_FOR_ME_URL, ASSIGN_URL,
  studentStateUrl, unlinkUrl, clearAssignedUrl,
} from "../config.js";

async function api(url, opts) {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "content-type": "application/json" },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || t("login.somethingWrong"));
  return data;
}

function signedOutNode() {
  return el("div.settings", {}, [
    el("h1", {}, t("parent.title")),
    el("section.panel", {}, [
      el("p.note", { style: { marginBottom: "12px" } }, t("parent.signInPrompt")),
      el("a.btn", { href: "#/login" }, t("login.signIn")),
    ]),
    el("a.btn.btn--ghost", { href: "#/" }, [icon(ICONS.back, 16), t("parent.backToMenu")]),
  ]);
}

// ---------- hub: /parent ----------

export function renderParentHub() {
  if (!store.authed) return { title: t("parent.title"), node: signedOutNode() };

  const studentsPanel = el("section.panel");
  const parentsPanel = el("section.panel");
  const assignedPanel = el("section.panel");
  const invitePanel = el("section.panel");

  async function refreshLinks() {
    let data;
    try { data = await api(LINKS_URL); }
    catch (e) { toast(e.message); return; }
    paintStudents(data.asParent);
    paintParents(data.asStudent);
  }

  function paintStudents(list) {
    clear(studentsPanel);
    studentsPanel.append(
      el("h3", { style: { marginBottom: "8px" } }, t("parent.studentsHeading")),
      list.length
        ? el("div", { style: { display: "grid", gap: "8px" } }, list.map(studentRow))
        : el("p.note", { style: { marginBottom: "12px" } }, t("parent.studentsNone")),
      redeemForm(),
    );
  }

  function studentRow(link) {
    const assignRow = el("div", { style: { display: "none", marginTop: "8px" } });
    const assignBtn = el("button.btn.btn--ghost.btn--sm", { type: "button" }, t("parent.assignSet"));
    assignBtn.addEventListener("click", () => {
      const opening = assignRow.style.display === "none";
      assignRow.style.display = opening ? "flex" : "none";
      if (opening && !assignRow.childNodes.length) assignRow.append(...assignPicker(link));
    });

    return el("div", { style: { padding: "12px", border: "1px solid var(--line)", borderRadius: "var(--r-md)" } }, [
      el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" } }, [
        el("a", { href: `#/parent/${link.studentUserId}`, style: { fontWeight: 700 } }, link.studentEmail),
        el("div", { style: { display: "flex", gap: "8px" } }, [
          assignBtn,
          el("button.btn.btn--ghost.btn--sm", {
            type: "button", style: { color: "var(--retry-ink)" },
            onclick: async () => {
              if (!confirm(t("parent.unlinkConfirm", { email: link.studentEmail }))) return;
              try { await api(unlinkUrl(link.linkId), { method: "DELETE" }); refreshLinks(); }
              catch (e) { toast(e.message); }
            },
          }, t("parent.unlink")),
        ]),
      ]),
      assignRow,
    ]);
  }

  function assignPicker(link) {
    if (!store.assignments.length) {
      return [el("p.note", {}, t("parent.noOwnSets"))];
    }
    const sel = el("select", {}, store.assignments.map((a) =>
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
    return [sel, btn];
  }

  function redeemForm() {
    const input = el("input", { type: "text", placeholder: "e.g. AB12CD", style: { textTransform: "uppercase" } });
    const btn = el("button.btn.btn--sm", { type: "button" }, t("parent.link"));
    btn.addEventListener("click", async () => {
      const code = input.value.trim();
      if (!code) return;
      btn.disabled = true;
      try {
        const data = await api(REDEEM_CODE_URL, { method: "POST", body: JSON.stringify({ code }) });
        toast(t("parent.linkedToStudent", { email: data.studentEmail }));
        input.value = "";
        refreshLinks();
      } catch (e) { toast(e.message); }
      btn.disabled = false;
    });
    return el("div", { style: { marginTop: "4px" } }, [
      el("label.field", { style: { marginBottom: "8px" } }, [el("span", {}, t("parent.haveCode")), input]),
      btn,
    ]);
  }

  function paintParents(list) {
    clear(parentsPanel);
    parentsPanel.append(
      el("h3", { style: { marginBottom: "8px" } }, t("parent.parentsHeading")),
      list.length
        ? el("div", { style: { display: "grid", gap: "8px" } }, list.map((link) =>
            el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", border: "1px solid var(--line)", borderRadius: "var(--r-md)" } }, [
              el("span", {}, link.parentEmail),
              el("button.btn.btn--ghost.btn--sm", {
                type: "button", style: { color: "var(--retry-ink)" },
                onclick: async () => {
                  if (!confirm(t("parent.unlinkConfirm", { email: link.parentEmail }))) return;
                  try { await api(unlinkUrl(link.linkId), { method: "DELETE" }); refreshLinks(); }
                  catch (e) { toast(e.message); }
                },
              }, t("parent.unlink")),
            ])))
        : el("p.note", {}, t("parent.parentsNone")),
    );
  }

  async function paintAssigned() {
    clear(assignedPanel);
    assignedPanel.append(el("h3", { style: { marginBottom: "8px" } }, t("parent.assignedToYouHeading")));
    let list;
    try { list = await api(ASSIGNED_FOR_ME_URL); }
    catch (e) { assignedPanel.append(el("p.note", {}, t("parent.assignedLoadFail"))); return; }

    if (!list.length) { assignedPanel.append(el("p.note", {}, t("parent.assignedNone"))); return; }
    assignedPanel.append(el("div", { style: { display: "grid", gap: "8px" } }, list.map((item) => {
      const btn = el("button.btn.btn--sm", { type: "button" }, t("parent.addToLibrary"));
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        store.addAssignmentDoc(item.doc);
        try { await api(clearAssignedUrl(item.id), { method: "DELETE" }); } catch {}
        toast(t("parent.addedToLibrary", { title: item.doc.title }));
        paintAssigned();
      });
      return el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", border: "1px solid var(--line)", borderRadius: "var(--r-md)", flexWrap: "wrap", gap: "8px" } }, [
        el("span", {}, [item.doc.title, el("span.note", { style: { display: "block" } }, t("parent.fromWho", { email: item.assignedByEmail }))]),
        btn,
      ]);
    })));
  }

  function paintInvite() {
    const status = el("p.note", { style: { margin: "6px 0 12px" } }, t("parent.inviteIntro"));
    const codeDisplay = el("p", { style: { display: "none", fontSize: "22px", fontWeight: 700, letterSpacing: "0.1em", fontFamily: "monospace" } });
    const btn = el("button.btn.btn--sm", { type: "button" }, t("parent.inviteGenerate"));
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        const data = await api(INVITE_CODE_URL, { method: "POST" });
        codeDisplay.textContent = data.code;
        codeDisplay.style.display = "";
        status.textContent = t("parent.inviteShare");
      } catch (e) { toast(e.message); }
      btn.disabled = false;
    });
    invitePanel.append(el("h3", { style: { marginBottom: "8px" } }, t("parent.inviteHeading")), status, codeDisplay, btn);
  }

  refreshLinks();
  paintAssigned();
  paintInvite();

  const node = el("div.settings", {}, [
    el("h1", {}, t("parent.title")),
    invitePanel,
    studentsPanel,
    parentsPanel,
    assignedPanel,
    el("a.btn.btn--ghost", { href: "#/" }, [icon(ICONS.back, 16), t("parent.backToMenu")]),
  ]);

  return { title: t("parent.title"), node };
}

// ---------- per-student read-only detail: /parent/:studentId ----------

export async function renderParentStudent(studentUserId) {
  if (!store.authed) return { title: t("parent.title"), node: signedOutNode() };

  let blob;
  try {
    const data = await api(studentStateUrl(studentUserId));
    blob = data.blob;
  } catch (e) {
    return {
      title: t("parent.title"),
      node: el("div.settings", {}, [
        el("h1", {}, t("parent.notAvailable")),
        el("section.panel", {}, [el("p.note", {}, e.message)]),
        el("a.btn.btn--ghost", { href: "#/parent" }, [icon(ICONS.back, 16), t("parent.back")]),
      ]),
    };
  }

  if (!blob) {
    return {
      title: t("parent.title"),
      node: el("div.settings", {}, [
        el("h1", {}, t("parent.noDataTitle")),
        el("section.panel", {}, [el("p.note", {}, t("parent.noDataBody"))]),
        el("a.btn.btn--ghost", { href: "#/parent" }, [icon(ICONS.back, 16), t("parent.back")]),
      ]),
    };
  }

  const tm = masteryByTopic(blob.attempts || []);
  const streak = currentStreak(blob.activity?.daysStudied || [], blob.activity?.frozenDays || []);
  const due = dueQuestions(blob.assignments || [], blob.srs || {});

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

  const node = el("div.settings", {}, [
    el("h1", {}, t("parent.studentProgressTitle")),

    el("section.panel", {}, [
      el("h3", { style: { marginBottom: "10px", display: "flex", alignItems: "center", gap: "10px" } }, [
        t("parent.studyStreak"),
        el("span.streakbadge", {}, [icon(ICONS.flame, 13), plural(streak, "parent.streakDay", "parent.streakDays")]),
      ]),
      el("p.note", {}, t("parent.daysSessions", {
        days: (blob.activity?.daysStudied || []).length,
        sessions: (blob.attempts || []).length,
      })),
    ]),

    el("section.panel", {}, [
      el("h3", { style: { marginBottom: "8px" } }, t("parent.masteryHeading")),
      meters.length ? el("div", {}, meters) : el("p.note", {}, t("parent.noMastery")),
    ]),

    el("section.panel", {}, [
      el("h3", {}, `${t("parent.dueHeading")}${due.length ? ` (${due.length})` : ""}`),
      due.length ? el("p.note", {}, t("parent.dueCount", { n: due.length })) : el("p.note", {}, t("parent.dueNone")),
    ]),

    el("a.btn.btn--ghost", { href: "#/parent" }, [icon(ICONS.back, 16), t("parent.back")]),
  ]);

  return { title: t("parent.studentProgressTitle"), node };
}

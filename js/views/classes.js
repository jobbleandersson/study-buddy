// Class mode. #/classes is the hub — the classes you teach, the classes you're
// in (with what your teacher has assigned), and a box for a class code.
// #/classes/<id> is a teacher's page for one class: its code, assigning a
// ready-made set to everyone, and a grid of how each student is doing.

import { store } from "../store.js";
import { el, clear, toast, icon, ICONS } from "../lib/dom.js";
import { t, plural, getLang, relativeDay, sentenceCase } from "../lib/i18n.js";
import { serverMessage } from "../lib/server-errors.js";
import { homeButton } from "../components/nav.js";
import { confirmDialog } from "../components/confirm-dialog.js";
import { classDailyPanel } from "../components/class-daily-panel.js";
import { classWizard } from "../components/class-wizard.js";
import { openClassShareSlide } from "../components/class-share-slide.js";
import { foldedDatePicker } from "../components/calendar.js";
import { localDayKey } from "../lib/activity.js";
import { loadLibraryIndex, loadLibraryTranslations, isImported, importSet } from "../data/library.js";
import { setProgress } from "../lib/mastery.js";
import { CLASSES_URL, CLASS_JOIN_URL, MY_CLASS_ASSIGNMENTS_URL, classUrl } from "../config.js";

async function api(url, opts) {
  const res = await fetch(url, { credentials: "include", headers: { "content-type": "application/json" }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(serverMessage(data?.error?.message, t("login.somethingWrong")));
  return data;
}

/** The library with names in the current language — for set titles and the picker. */
async function libraryNames() {
  const index = await loadLibraryIndex();
  const tr = getLang() === "en" ? await loadLibraryTranslations() : { levels: {}, subjects: {}, sets: {} };
  return {
    index,
    setTitle: (id) => tr.sets[id]?.title || index.sets.find((s) => s.id === id)?.title || id,
    subjectName: (s) => tr.subjects[s.id]?.name || s.name,
    levelLabel: (l) => tr.levels[l.id] || l.label,
  };
}

function signedOut(qs) {
  // A join code on the URL (someone followed a share-slide link before signing
  // up) rides along through sign-in, so it's still there to fill the join box
  // with once they land back here — see renderClasses's own prefillCode below.
  const code = (qs?.get?.("code") || "").trim();
  const next = code ? `#/classes?code=${encodeURIComponent(code)}` : "#/classes";
  return el("div.settings", {}, [
    el("h1", {}, t("classes.title")),
    el("section.panel", {}, [
      el("p.note", { style: { marginBottom: "12px" } }, t("classes.signInPrompt")),
      el("a.btn", { href: `#/login?next=${encodeURIComponent(next)}` }, t("login.signIn")),
    ]),
    el("a.btn.btn--ghost", { href: "#/" }, [icon(ICONS.back, 16), t("parent.backToMenu")]),
  ]);
}

const row = (children) => el("div.classrow", {}, children);

// ---------- the hub: #/classes ----------

export async function renderClasses(qs) {
  if (!store.authed) return { title: t("classes.title"), node: signedOut(qs) };
  // A code arriving on the URL (e.g. `#/classes?code=ABC123`, from a share slide
  // or a link a student passed along) fills the join box — nothing auto-submits.
  const prefillCode = (qs?.get?.("code") || "").trim().toUpperCase();

  let names = null;
  try { names = await libraryNames(); } catch { /* titles fall back to set ids */ }
  const title = (id) => (names ? names.setTitle(id) : id);

  const teachingPanel = el("section.panel");
  const memberPanel = el("section.panel");
  const joinPanel = el("section.panel");

  async function refresh() {
    let classes, given;
    try { [classes, given] = await Promise.all([api(CLASSES_URL), api(MY_CLASS_ASSIGNMENTS_URL)]); }
    catch (e) { toast(e.message || t("classes.loadFail")); return; }
    paintTeaching(classes.teaching);
    paintMember(classes.member, given);
  }

  function paintTeaching(list) {
    clear(teachingPanel);
    const input = el("input", { id: "class-name", type: "text", maxlength: "60", placeholder: t("classes.createPlaceholder") });
    const btn = el("button.btn.btn--sm", { type: "button" }, t("classes.create"));
    btn.addEventListener("click", async () => {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      btn.disabled = true;
      try {
        const made = await api(CLASSES_URL, { method: "POST", body: JSON.stringify({ name }) });
        location.hash = `#/classes/${made.id}`;
      } catch (e) { toast(e.message); btn.disabled = false; }
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") btn.click(); });

    teachingPanel.append(
      el("h3", { style: { marginBottom: "8px" } }, t("classes.teachingHeading")),
      list.length
        ? el("div", { style: { display: "grid", gap: "8px", marginBottom: "16px" } }, list.map((c) => row([
            el("div", {}, [
              el("a", { href: `#/classes/${c.id}`, style: { fontWeight: 700 } }, c.name),
              el("span.note", { style: { display: "block" } }, [
                plural(c.memberCount, "classes.studentOne", "classes.studentMany"), " · ",
                plural(c.assignmentCount, "classes.assignmentOne", "classes.assignmentMany"), " · ",
                t("classes.codeShort", { code: c.code }),
              ].join("")),
            ]),
            el("a.btn.btn--ghost.btn--sm", { href: `#/classes/${c.id}` }, t("classes.resultsHeading")),
          ])))
        : el("p.note", { style: { marginBottom: "12px" } }, [
            t("classes.teachingNone"), " ",
            el("a", { href: "#/teachers" }, t("lp.teacherLink")),
          ]),
      el("label.field", { style: { marginBottom: "8px" } }, [el("span", {}, t("classes.createLabel")), input]),
      btn,
    );
  }

  function assignmentRow(a) {
    const entry = names?.index.sets.find((s) => s.id === a.setId);
    const mine = store.getAssignment(a.setId);
    const p = mine ? setProgress(mine, store.attempts) : null;
    const status = p && p.seen ? t("lib.progressOf", { n: p.known, total: p.total }) : t("lib.notStarted");
    const btn = el("button.btn.btn--sm", { type: "button", disabled: !entry }, [icon(ICONS.play, 16), t("lib.study")]);
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try { if (!isImported(a.setId)) await importSet(entry); }
      catch { toast(t("lib.addFail")); btn.disabled = false; return; }
      location.hash = `#/session/${a.setId}`;
    });
    return row([
      el("div", {}, [
        el("span", { style: { fontWeight: 600 } }, title(a.setId)),
        el("span.note", { style: { display: "block" } }, [status, a.dueAt ? ` · ${t("classes.due", { when: relativeDay(a.dueAt) })}` : ""].join("")),
      ]),
      btn,
    ]);
  }

  function paintMember(list, given) {
    clear(memberPanel);
    memberPanel.append(el("h3", { style: { marginBottom: "8px" } }, t("classes.memberHeading")));
    if (!list.length) { memberPanel.append(el("p.note", {}, t("classes.memberNone"))); return; }
    memberPanel.append(el("div", { style: { display: "grid", gap: "16px" } }, list.map((c) => {
      const items = given.filter((g) => g.classId === c.id);
      return el("div", {}, [
        el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "8px", flexWrap: "wrap", marginBottom: "8px" } }, [
          el("div", {}, [
            el("strong", {}, c.name),
            el("span.note", { style: { display: "block" } }, t("classes.teacher", { email: c.teacherEmail })),
          ]),
          el("button.btn.btn--ghost.btn--sm", {
            type: "button", style: { color: "var(--retry-ink)" },
            onclick: async () => {
              if (!(await confirmDialog({ message: t("classes.leaveConfirm", { name: c.name }), confirmLabel: t("classes.leave"), danger: true }))) return;
              try { await api(`${classUrl(c.id)}/membership`, { method: "DELETE" }); toast(t("classes.left", { name: c.name })); refresh(); }
              catch (e) { toast(e.message); }
            },
          }, t("classes.leave")),
        ]),
        items.length
          ? el("div", { style: { display: "grid", gap: "8px" } }, items.map(assignmentRow))
          : el("p.note", {}, t("classes.noAssignments")),
      ]);
    })));
  }

  function paintJoin() {
    const input = el("input", { id: "class-code", type: "text", maxlength: "12", autocomplete: "off", value: prefillCode, placeholder: t("classes.joinPlaceholder"), style: { textTransform: "uppercase" } });
    const btn = el("button.btn.btn--sm", { type: "button" }, t("classes.join"));
    btn.addEventListener("click", async () => {
      const code = input.value.trim();
      if (!code) { input.focus(); return; }
      btn.disabled = true;
      try {
        const joined = await api(CLASS_JOIN_URL, { method: "POST", body: JSON.stringify({ code }) });
        toast(t("classes.joined", { name: joined.name }));
        input.value = "";
        refresh();
      } catch (e) { toast(e.message); }
      btn.disabled = false;
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") btn.click(); });
    joinPanel.append(
      el("h3", { style: { marginBottom: "8px" } }, t("classes.joinHeading")),
      el("p.note", { style: { marginBottom: "12px" } }, t("classes.joinNote")),
      el("label.field", { style: { marginBottom: "8px" } }, [el("span", {}, t("classes.joinLabel")), input]),
      btn,
    );
  }

  paintJoin();
  refresh();

  const node = el("div.settings", {}, [
    homeButton({ grid: true }),
    el("h1", {}, t("classes.title")),
    memberPanel,
    joinPanel,
    teachingPanel,
    el("a.btn.btn--ghost", { href: "#/" }, [icon(ICONS.back, 16), t("parent.backToMenu")]),
  ]);
  return { title: t("classes.title"), node };
}

// ---------- one class, for its teacher: #/classes/<id> ----------

const cellTone = (known, total) => {
  const pct = total ? known / total : 0;
  return pct >= 0.8 ? "hi" : pct >= 0.5 ? "mid" : "lo";
};

export async function renderClassDetail(id) {
  if (!store.authed) return { title: t("classes.title"), node: signedOut() };

  let cls, results, names;
  try {
    [cls, results, names] = await Promise.all([api(classUrl(id)), api(`${classUrl(id)}/results`), libraryNames()]);
  } catch (e) {
    return {
      title: t("classes.title"),
      node: el("div.empty", {}, [
        el("h2", {}, e.message || t("classes.loadFail")),
        el("a.btn.btn--ghost", { href: "#/classes", style: { marginTop: "16px" } }, t("classes.back")),
      ]),
    };
  }
  const reload = () => renderClassDetailInto();
  const root = el("div.settings");
  // Built once, so what's typed into it survives the page repainting after an assignment.
  const wizard = classWizard(id, cls, {
    onOpenShare: () => openClassShareSlide({ name: cls.name, code: cls.code }),
    onJumpToAssign: () => {
      document.getElementById("class-assign-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      document.getElementById("assign-subject")?.focus();
    },
  });
  // dailyPanel already fetches this class's daily questions for its own display —
  // feed that same list to the wizard's step 3 instead of asking the server again.
  const dailyPanel = classDailyPanel(id, { onChange: (data) => wizard.setDaily((data?.items?.length || 0) > 0) });

  function assignForm() {
    const subjectSel = el("select", { id: "assign-subject" });
    for (const level of names.index.levels) {
      const subjects = names.index.subjects.filter((s) => s.level === level.id);
      if (!subjects.length) continue;
      subjectSel.append(el("optgroup", { label: names.levelLabel(level) },
        subjects.map((s) => el("option", { value: s.id }, names.subjectName(s)))));
    }
    const setSel = el("select", { id: "assign-set" });
    const fillSets = () => {
      clear(setSel);
      for (const s of names.index.sets.filter((x) => x.subject === subjectSel.value)) {
        setSel.append(el("option", { value: s.id }, names.setTitle(s.id)));
      }
    };
    subjectSel.addEventListener("change", fillSets);
    fillSets();

    const due = foldedDatePicker({ label: t("classes.assignDue"), min: localDayKey() });
    const btn = el("button.btn.btn--sm", { type: "button" }, t("classes.assign"));
    btn.addEventListener("click", async () => {
      if (!setSel.value) return;
      btn.disabled = true;
      try {
        await api(`${classUrl(id)}/assignments`, { method: "POST", body: JSON.stringify({ setId: setSel.value, dueAt: due.getValue() || null }) });
        toast(t("classes.assigned", { title: names.setTitle(setSel.value) }));
        await reload();
      } catch (e) { toast(e.message); btn.disabled = false; }
    });

    return el("section.panel#class-assign-panel", {}, [
      el("h3", { style: { marginBottom: "12px" } }, t("classes.assignHeading")),
      el("div", { style: { display: "grid", gap: "8px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginBottom: "12px" } }, [
        el("label.field", { style: { margin: 0 } }, [el("span", {}, t("classes.assignSubject")), subjectSel]),
        el("label.field", { style: { margin: 0 } }, [el("span", {}, t("classes.assignSet")), setSel]),
      ]),
      due.el,
      btn,
    ]);
  }

  function resultsPanel() {
    const panel = el("section.panel", {}, [el("h3", { style: { marginBottom: "12px" } }, t("classes.resultsHeading"))]);
    if (!cls.members.length) { panel.append(el("p.note", {}, t("classes.noStudentsHelp"))); return panel; }
    if (!cls.assignments.length) { panel.append(el("p.note", {}, t("classes.noneAssigned"))); return panel; }

    const byId = new Map(results.assignments.map((a) => [a.id, a]));
    const head = el("tr", {}, [
      el("th", {}, t("classes.studentCol")),
      ...cls.assignments.map((a) => el("th", {}, [
        el("div.classgrid__title", {}, names.setTitle(a.setId)),
        a.dueAt ? el("span.note", { style: { display: "block", fontWeight: 400 } }, t("classes.due", { when: relativeDay(a.dueAt) })) : null,
        el("button.iconbtn.iconbtn--sm", {
          type: "button", "aria-label": t("classes.removeAssignment"), title: t("classes.removeAssignment"),
          onclick: async () => {
            if (!(await confirmDialog({ message: t("classes.removeAssignmentConfirm", { title: names.setTitle(a.setId) }), confirmLabel: t("classes.removeAssignment"), danger: true }))) return;
            try { await api(`${classUrl(id)}/assignments/${a.id}`, { method: "DELETE" }); await reload(); } catch (e) { toast(e.message); }
          },
        }, [icon(ICONS.close, 14)]),
      ].filter(Boolean))),
    ]);

    const body = cls.members.map((m) => el("tr", {}, [
      el("td", {}, el("div.classgrid__student", {}, [
        el("span", {}, m.email),
        el("button.iconbtn.iconbtn--sm", {
          type: "button", "aria-label": t("classes.removeStudent", { email: m.email }), title: t("classes.removeStudent", { email: m.email }),
          onclick: async () => {
            if (!(await confirmDialog({ message: t("classes.removeStudentConfirm", { email: m.email }), confirmLabel: t("classes.remove"), danger: true }))) return;
            try { await api(`${classUrl(id)}/members/${m.userId}`, { method: "DELETE" }); await reload(); } catch (e) { toast(e.message); }
          },
        }, [icon(ICONS.close, 14)]),
      ])),
      ...cls.assignments.map((a) => {
        const r = byId.get(a.id)?.students.find((s) => s.userId === m.userId);
        if (!r || !r.seen) return el("td", {}, el("span.classcell.classcell--none", { title: t("classes.notDoneTip") }, "–"));
        const total = byId.get(a.id).total;
        return el("td", {}, el(`span.classcell.classcell--${cellTone(r.known, total)}`, { title: t("classes.cellTip", { seen: r.seen, total }) }, `${r.known}/${total}`));
      }),
    ]));

    panel.append(el("div.classgrid-wrap", {}, el("table.classgrid", {}, [el("thead", {}, head), el("tbody", {}, body)])));

    // What the class misses most, per assignment.
    for (const a of cls.assignments) {
      const topics = byId.get(a.id)?.topics || [];
      if (!topics.length) continue;
      panel.append(el("div", { style: { marginTop: "20px" } }, [
        el("h4", { style: { marginBottom: "4px" } }, t("classes.topicsHeading", { title: names.setTitle(a.setId) })),
        el("p.note", { style: { marginBottom: "8px" } }, t("classes.topicsNote")),
        ...topics.map((tp) => {
          const pct = Math.round((100 * tp.wrong) / tp.answered);
          return el("div.classmiss", {}, [
            el("span.classmiss__topic", {}, sentenceCase(tp.topic)),
            el("span.classmiss__bar", { role: "img", "aria-label": t("classes.missRate", { pct }) }, el("i", { style: { width: `${pct}%` } })),
            el("span.note", { style: { minWidth: "64px", textAlign: "right" } }, t("classes.missRate", { pct })),
          ]);
        }),
      ]));
    }
    return panel;
  }

  function paint() {
    clear(root);
    const copy = el("button.btn.btn--ghost.btn--sm", { type: "button" }, [icon(ICONS.copy, 16), t("classes.copyCode")]);
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(cls.code); toast(t("classes.codeCopied")); } catch { /* the code is on screen to read out */ }
    });
    root.append(
      el("a.btn.btn--ghost.btn--sm", { href: "#/classes", style: { marginBottom: "12px" } }, [icon(ICONS.back, 16), t("classes.back")]),
      el("h1", {}, cls.name),
      el("section.panel", {}, [
        el("p.note", { style: { marginBottom: "4px" } }, t("classes.code")),
        el("div", { style: { display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" } }, [
          el("span.classcode", {}, cls.code),
          copy,
          el("span.note", {}, plural(cls.members.length, "classes.studentOne", "classes.studentMany")),
        ]),
      ]),
      wizard.el,
      assignForm(),
      dailyPanel,
      resultsPanel(),
      el("button.btn.btn--ghost.btn--sm", {
        type: "button", style: { color: "var(--retry-ink)", marginTop: "8px" },
        onclick: async () => {
          if (!(await confirmDialog({ message: t("classes.deleteConfirm", { name: cls.name }), confirmLabel: t("classes.deleteClass"), danger: true }))) return;
          try { await api(classUrl(id), { method: "DELETE" }); location.hash = "#/classes"; } catch (e) { toast(e.message); }
        },
      }, t("classes.deleteClass")),
    );
  }

  async function renderClassDetailInto() {
    [cls, results] = await Promise.all([api(classUrl(id)), api(`${classUrl(id)}/results`)]);
    paint();
    wizard.refresh(cls);
  }

  paint();
  return { title: cls.name, node: root };
}

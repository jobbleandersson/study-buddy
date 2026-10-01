// Class mode. #/classes is the hub — the classes you're in (with what your
// teacher has assigned), a box for a class code, and the classes you teach.
// #/classes/<id> is a teacher's page for one class: its code, assigning a
// ready-made set to everyone, and a grid of how each student is doing.
//
// Built from the same cards and rows as Settings (components/set-ui.js).

import { store } from "../store.js";
import { el, clear, toast, icon, ICONS } from "../lib/dom.js";
import { t, plural, getLang, relativeDay, daysUntil, sentenceCase } from "../lib/i18n.js";
import { serverMessage } from "../lib/server-errors.js";
import { homeButton } from "../components/nav.js";
import { confirmDialog } from "../components/confirm-dialog.js";
import { classDailyPanel } from "../components/class-daily-panel.js";
import { classWizard } from "../components/class-wizard.js";
import { openClassShareSlide } from "../components/class-share-slide.js";
import { foldedDatePicker } from "../components/calendar.js";
import { row, card, pageHead, emptyState, avatar, chip, codeField } from "../components/set-ui.js";
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
  return el("div.settings.settings--narrow", {}, [
    homeButton({ grid: true }),
    pageHead(t("classes.title"), t("classes.pageSub")),
    card(ICONS.presentation, t("classes.title"), null, [
      row(t("classes.signInLabel"), t("classes.signInPrompt"),
        el("a.btn.btn--sm", { href: `#/login?next=${encodeURIComponent(next)}` }, t("login.signIn"))),
    ]),
  ]);
}

/** "Senast imorgon" as a chip — warm when it's close. */
function dueChip(dueAt) {
  if (!dueAt) return null;
  const d = daysUntil(dueAt);
  return chip(t("classes.due", { when: relativeDay(dueAt) }), d <= 2 ? "warn" : undefined);
}

// ---------- the hub: #/classes ----------

export async function renderClasses(qs) {
  if (!store.authed) return { title: t("classes.title"), node: signedOut(qs) };
  // A code arriving on the URL (e.g. `#/classes?code=ABC123`, from a share slide
  // or a link a student passed along) fills the join box — nothing auto-submits.
  const prefillCode = (qs?.get?.("code") || "").trim().toUpperCase();

  let names = null;
  try { names = await libraryNames(); } catch { /* titles fall back to set ids */ }
  const title = (id) => (names ? names.setTitle(id) : id);

  const loading = () => el("p.set-loading", {}, t("classes.loading"));
  const memberBody = el("div", {}, [loading()]);
  const teachingBody = el("div", {}, [loading()]);

  async function refresh() {
    let classes, given;
    try { [classes, given] = await Promise.all([api(CLASSES_URL), api(MY_CLASS_ASSIGNMENTS_URL)]); }
    catch (e) {
      toast(e.message || t("classes.loadFail"));
      for (const body of [memberBody, teachingBody]) {
        body.replaceChildren(emptyState(ICONS.close, t("classes.loadFail"),
          el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => { memberBody.replaceChildren(loading()); teachingBody.replaceChildren(loading()); refresh(); } }, t("classes.retry"))));
      }
      return;
    }
    paintTeaching(classes.teaching);
    paintMember(classes.member, given);
  }

  function paintTeaching(list) {
    const input = el("input", { id: "class-name", type: "text", maxlength: "60", placeholder: t("classes.createPlaceholder"), "aria-label": t("classes.createLabel") });
    const btn = el("button.btn.btn--sm", { type: "button" }, [icon(ICONS.plus, 15), t("classes.create")]);
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

    teachingBody.replaceChildren(...[
      list.length
        ? el("div.set-list", {}, list.map((c) => row(
            el("a.set-row__link", { href: `#/classes/${c.id}` }, c.name),
            [
              plural(c.memberCount, "classes.studentOne", "classes.studentMany"),
              plural(c.assignmentCount, "classes.assignmentOne", "classes.assignmentMany"),
            ].join(" · "),
            [
              el("span.set-codechip", { title: t("classes.code") }, c.code),
              el("a.btn.btn--ghost.btn--sm", { href: `#/classes/${c.id}` }, [t("classes.open"), icon(ICONS.arrow, 14)]),
            ],
            { lead: avatar(c.name, { square: true }) },
          )))
        : emptyState(ICONS.presentation, t("classes.teachingNone"), el("a.linkbtn", { href: "#/teachers" }, t("lp.teacherLink"))),
      row(t("classes.createLabel"), t("classes.createNote"), el("div.set-inline", {}, [input, btn])),
    ]);
  }

  function assignmentRow(a) {
    const entry = names?.index.sets.find((s) => s.id === a.setId);
    const mine = store.getAssignment(a.setId);
    const p = mine ? setProgress(mine, store.attempts) : null;
    const started = !!(p && p.seen);
    const done = started && p.known >= p.total;
    const status = started
      ? chip(t("lib.progressOf", { n: p.known, total: p.total }), done ? "ok" : "brand")
      : chip(t("lib.notStarted"));
    const btn = el("button.btn.btn--sm", { type: "button", disabled: !entry }, [icon(ICONS.play, 15), t("lib.study")]);
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try { if (!isImported(a.setId)) await importSet(entry); }
      catch { toast(t("lib.addFail")); btn.disabled = false; return; }
      location.hash = `#/session/${a.setId}`;
    });
    return row(title(a.setId), el("span.set-chips", {}, [status, dueChip(a.dueAt)].filter(Boolean)), btn);
  }

  function paintMember(list, given) {
    if (!list.length) {
      memberBody.replaceChildren(emptyState(ICONS.book, t("classes.memberNone")));
      return;
    }
    memberBody.replaceChildren(...list.map((c) => {
      const items = given.filter((g) => g.classId === c.id);
      const leave = el("button.btn.btn--ghost.btn--sm.set-danger", {
        type: "button",
        onclick: async () => {
          if (!(await confirmDialog({ message: t("classes.leaveConfirm", { name: c.name }), confirmLabel: t("classes.leave"), danger: true }))) return;
          try { await api(`${classUrl(c.id)}/membership`, { method: "DELETE" }); toast(t("classes.left", { name: c.name })); refresh(); }
          catch (e) { toast(e.message); }
        },
      }, t("classes.leave"));
      return el("div.set-group", {}, [
        row(c.name, t("classes.teacher", { email: c.teacherEmail }), leave, { lead: avatar(c.name, { square: true }) }),
        items.length
          ? el("div.set-sublist", {}, items.map(assignmentRow))
          : el("p.set-sublist__empty", {}, t("classes.noAssignments")),
      ]);
    }));
  }

  // Join box.
  const codeInput = el("input", {
    id: "class-code", type: "text", maxlength: "12", autocomplete: "off", spellcheck: "false",
    value: prefillCode, placeholder: t("classes.joinPlaceholder"), "aria-label": t("classes.joinLabel"),
  });
  const joinBtn = el("button.btn.btn--sm", { type: "button" }, t("classes.join"));
  joinBtn.addEventListener("click", async () => {
    const code = codeInput.value.trim();
    if (!code) { codeInput.focus(); return; }
    joinBtn.disabled = true;
    try {
      const joined = await api(CLASS_JOIN_URL, { method: "POST", body: JSON.stringify({ code }) });
      toast(t("classes.joined", { name: joined.name }));
      codeInput.value = "";
      refresh();
    } catch (e) { toast(e.message); }
    joinBtn.disabled = false;
  });
  codeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") joinBtn.click(); });

  refresh();

  const node = el("div.settings.settings--narrow", {}, [
    homeButton({ grid: true }),
    pageHead(t("classes.title"), t("classes.pageSub")),
    card(ICONS.book, t("classes.memberHeading"), t("classes.memberSub"), [memberBody]),
    card(ICONS.plus, t("classes.joinHeading"), t("classes.joinNote"), [
      row(t("classes.joinLabel"), t("classes.joinHelp"), codeField(codeInput, joinBtn)),
    ]),
    card(ICONS.presentation, t("classes.teachingHeading"), t("classes.teachingSub"), [teachingBody]),
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
  const root = el("div.settings.settings--narrow");
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
    const btn = el("button.btn.btn--sm", { type: "button" }, [icon(ICONS.plus, 15), t("classes.assign")]);
    btn.addEventListener("click", async () => {
      if (!setSel.value) return;
      btn.disabled = true;
      try {
        await api(`${classUrl(id)}/assignments`, { method: "POST", body: JSON.stringify({ setId: setSel.value, dueAt: due.getValue() || null }) });
        toast(t("classes.assigned", { title: names.setTitle(setSel.value) }));
        await reload();
      } catch (e) { toast(e.message); btn.disabled = false; }
    });

    return card(ICONS.plus, t("classes.assignHeading"), t("classes.assignSub"), [
      el("div.set-form", {}, [
        el("div.set-form__grid", {}, [
          el("label.field", {}, [el("span", {}, t("classes.assignSubject")), subjectSel]),
          el("label.field", {}, [el("span", {}, t("classes.assignSet")), setSel]),
        ]),
        due.el,
        el("div", {}, [btn]),
      ]),
    ], { id: "class-assign-panel" });
  }

  function resultsPanel() {
    const body = [];
    if (!cls.members.length) {
      body.push(emptyState(ICONS.users, t("classes.noStudentsHelp")));
    } else if (!cls.assignments.length) {
      body.push(emptyState(ICONS.chart, t("classes.noneAssigned")));
    } else {
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

      const rows = cls.members.map((m) => el("tr", {}, [
        el("td", {}, el("div.classgrid__student", {}, [
          avatar(m.email),
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

      body.push(el("div.classgrid-wrap", {}, el("table.classgrid", {}, [el("thead", {}, head), el("tbody", {}, rows)])));

      // What the class misses most, per assignment.
      for (const a of cls.assignments) {
        const topics = byId.get(a.id)?.topics || [];
        if (!topics.length) continue;
        body.push(el("div.set-misses", {}, [
          el("h3", {}, t("classes.topicsHeading", { title: names.setTitle(a.setId) })),
          el("p.set-row__note", {}, t("classes.topicsNote")),
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
    }
    return card(ICONS.chart, t("classes.resultsHeading"), t("classes.resultsSub"), body);
  }

  function paint() {
    clear(root);
    const copy = el("button.btn.btn--ghost.btn--sm", { type: "button" }, [icon(ICONS.copy, 15), t("classes.copyCode")]);
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(cls.code); toast(t("classes.codeCopied")); } catch { /* the code is on screen to read out */ }
    });
    const show = el("button.btn.btn--sm", { type: "button", onclick: () => openClassShareSlide({ name: cls.name, code: cls.code }) },
      [icon(ICONS.presentation, 15), t("classes.wizardShareCta")]);
    root.append(
      el("a.btn.btn--ghost.btn--sm.set-back", { href: "#/classes" }, [icon(ICONS.back, 16), t("classes.back")]),
      pageHead(cls.name, [
        plural(cls.members.length, "classes.studentOne", "classes.studentMany"),
        plural(cls.assignments.length, "classes.assignmentOne", "classes.assignmentMany"),
      ].join(" · ")),
      card(ICONS.users, t("classes.code"), t("classes.codeSub"), [
        el("div.set-bigcode", {}, [
          el("span.set-bigcode__code", { "aria-label": `${t("classes.code")}: ${cls.code.split("").join(" ")}` }, cls.code),
          el("div.set-row__ctl", {}, [copy, show]),
        ]),
      ]),
      wizard.el,
      assignForm(),
      dailyPanel,
      resultsPanel(),
      card(ICONS.gear, t("classes.manageHeading"), null, [
        row(t("classes.deleteClass"), t("classes.deleteNote"), el("button.btn.btn--ghost.btn--sm.set-danger", {
          type: "button",
          onclick: async () => {
            if (!(await confirmDialog({ message: t("classes.deleteConfirm", { name: cls.name }), confirmLabel: t("classes.deleteClass"), danger: true }))) return;
            try { await api(classUrl(id), { method: "DELETE" }); location.hash = "#/classes"; } catch (e) { toast(e.message); }
          },
        }, t("classes.deleteClass")), { danger: true }),
      ]),
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

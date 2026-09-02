# StudyBuddy

An AI study buddy that tutors a student through their own assignments and tests —
the way a real tutor would: it explains, asks questions, gives hints, checks answers,
and adapts when you're stuck.

Built for K–12. No framework, no build step, no npm — plain HTML, CSS, and ES modules.

**Live:** <https://annonsjakt.github.io/study-buddy/> — the frontend, hosted on GitHub
Pages. Runs in demo mode only, since Pages serves static files and there's no `server/`
behind it; run `server/` locally for live mode (see below).

## Run it

`server/` now serves the whole app — frontend and API — from one process on one port,
so this is the only step needed for the full experience (demo mode works with no setup;
add a Claude key for live mode):

```bash
cd server
npm install
cp .env.example .env   # optionally fill in ANTHROPIC_API_KEY for live mode
npm start
```

Then open <http://localhost:8787>. See `server/README.md` for details.

**Frontend only, no Node:** double-click `serve.ps1` → "Run with PowerShell" (or
`powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 8000`), or use any other
static file server. This runs the UI in demo mode only — with `server/` not serving
it, there's no API for it to reach. Opening `index.html` directly with `file://` will
**not** work either way — ES modules need to be served over http.

## What's in it

- **Menu** — a "today" strip (what's due, what you left unfinished, your streak),
  `Assignments` / `Tests` tabs, subject filters, search and sort, and a card grid
  with a mastery ring per set. Each card has a ⋮ menu: rename, edit questions,
  duplicate, delete.
- **Session** — one question at a time on the left, an **adaptive tutor** chat on the
  right that remembers how the session has been going. Four question types: multiple
  choice, short written answer, flashcard, and worked (step-by-step) problems.
  You can skip a question — it comes back at the end. Repeat runs shuffle both the
  question order and the multiple-choice options. Leaving asks first and saves your
  place, so you can pick up where you left off.
- **Tests behave like tests** — the tutor sits out, one attempt per question, nothing
  revealed. All the teaching happens afterwards.
- **Results** — animated score ring, elapsed time, per-topic mastery change, confetti
  at 80%+, and a **Practise these now** button that drills just what you missed.
- **Progress** — study streak, mastery meter per subject, and **Review today**, which
  builds a session from the questions that are due across *every* set (SM-2-lite).
- **Create** — generate a new set from your own material: paste text, upload a PDF
  (text is extracted locally), upload a photo, or just type a topic. Review and edit
  every question before saving.

Light and dark themes (or follow your device), full keyboard shortcuts in a session
(press `?` to see them), and it installs to a home screen and runs offline in demo mode.

Everything (assignments, attempts, progress) is stored in your browser's
`localStorage`. Settings → **Export JSON** makes a backup.

## Demo mode vs. live mode

Without the backend proxy (see `server/`) running and reachable, StudyBuddy runs in
**demo mode**: the two sample sets (Photosynthesis Basics, Ancient Rome Quiz) are fully
playable and the tutor follows a scripted hint ladder. Your library starts empty — load
the demo sets from the home screen or from Settings → Demo content.

Run `server/` with a Claude key configured (see `server/README.md`) to turn on **live
mode**: real question generation from your material, a real streaming tutor, and AI
grading of written answers. Settings shows whether the tutor server is connected.

**Model presets.** Different jobs use different models, so you're not paying top rates
to mark a one-line answer:

| Preset | Writes a set | Tutors you | Marks answers |
|---|---|---|---|
| **Balanced** (default) | Opus 5 | Sonnet 5 | Haiku 4.5 |
| Best quality | Opus 5 | Opus 5 | Opus 5 |
| Lowest cost | Sonnet 5 | Haiku 4.5 | Haiku 4.5 |

### ⚠️ Security note

The Claude API key lives only on the machine running `server/` — the browser never sees
it. `/api/state`, `/api/links`, and `/api/assigned` all require a signed-in session.
`/api/messages` (the Claude proxy) itself still has no per-request auth of its own,
though — anyone who can reach the deployment can spend the configured key regardless of
whether they've signed in. Understand that before hosting this somewhere public — see
`server/README.md`.

## Project layout

```
serve.ps1            frontend-only dev server (Windows PowerShell, no dependencies) — demo mode only
index.html           shell — fonts, vendored libs, manifest, theme bootstrap
manifest.json        PWA manifest (installable to a home screen)
sw.js                service worker — network-first, cache fallback for offline
css/tokens.css       design tokens (colour, type, spacing, motion) + dark theme
css/app.css          layout + components
js/main.js           hash router, app shell, service-worker registration
js/store.js          localStorage state, with a migrate() seam for future accounts
js/claude.js         Claude API client + per-task model presets
js/prompts.js        system prompts, question shape, tutor session digest
js/material.js       paste / PDF / image / topic -> generation inputs
js/views/            one file per screen (menu, create, edit, session, results,
                     progress, settings)
js/components/       question renderers, shared question editor, tutor chat, mascot
js/lib/              srs, mastery, activity/streak, theme, a11y, markdown, dom
js/config.js          backend server URLs
js/views/login.js    email/password sign in, optional
js/views/parent-dashboard.js   linking, assigning sets, read-only student progress
js/lib/library.js    pure findQuestion()/dueQuestions(), reused for a linked student's data
data/samples/        demo sets + scripted tutor (demo mode)
vendor/              pdf.js, KaTeX, canvas-confetti (committed, no npm)
server/              serves the frontend + API: key proxy, accounts/sync, parent-teacher
                     linking (Node/Express/SQLite) — see server/README.md
```

## Accounts & sync

Optional. StudyBuddy works fully signed out — everything stays in this browser's
`localStorage`, same as always. Sign in (Settings → Account) to also sync your
library and progress to an account, so it's there on another device too. Auth is
email/password; there's no email-sending step, so nothing to confirm — an account
is ready to use immediately.

Sync pushes your whole local library as one unit a moment after each change, and
pulls it once when you sign in elsewhere. If the same account is edited on two
devices before they've synced, the most recent save wins and the other device is
told its unsynced local changes were replaced — there's no field-by-field merge.
Fine for one person moving between their own devices; not built for simultaneous
editing.

## Parent / teacher view

Also optional, and separate from accounts & sync — you need an account, but a parent
or teacher watching a student doesn't need to be *the same* account. From the 🧑‍🤝‍🧑
icon in the header (visible once signed in):

- A student generates a short-lived invite code (Settings → Account → Parent / teacher
  linking, or the hub directly) and shares it with a parent or teacher, who redeems it
  to link the two accounts. Either side can unlink later.
- Once linked, the parent/teacher can assign one of their own sets to the student —
  it shows up under "Assigned to you" on the student's side, and importing it drops
  it straight into their normal library, no different from any other set.
- The parent/teacher gets a read-only progress view for each linked student (streak,
  mastery by subject, what's due) — the same numbers the student sees on their own
  Progress page, just fetched from their synced account instead of computed locally.

A parent/teacher can't edit a student's data, and a student's raw material never
leaves their account except the sets a linked parent/teacher explicitly assigned.

## Roadmap

- Voice chat — talk through problems out loud
- Share assignment sets with a friend

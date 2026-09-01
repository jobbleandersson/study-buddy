# StudyBuddy

An AI study buddy that tutors a student through their own assignments and tests —
the way a real tutor would: it explains, asks questions, gives hints, checks answers,
and adapts when you're stuck.

Built for K–12. No framework, no build step, no npm — plain HTML, CSS, and ES modules.

## Run it

**Windows (easiest):** double-click `serve.ps1` → "Run with PowerShell", then open the
URL it prints (default <http://localhost:8000>).

Or from a terminal:

```bash
powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 8000
```

Any static file server works too (e.g. the VS Code "Live Server" extension). Opening
`index.html` directly with `file://` will **not** work — ES modules need to be served
over http.

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

Without a Claude API key, StudyBuddy runs in **demo mode**: the two sample sets
(Photosynthesis Basics, Ancient Rome Quiz) are fully playable and the tutor follows a
scripted hint ladder. Your library starts empty — load the demo sets from the home
screen or from Settings → Demo content.

Add a key in **Settings** to turn on **live mode**: real question generation from your
material, a real streaming tutor, and AI grading of written answers.

**Model presets.** Different jobs use different models, so you're not paying top rates
to mark a one-line answer:

| Preset | Writes a set | Tutors you | Marks answers |
|---|---|---|---|
| **Balanced** (default) | Opus 5 | Sonnet 5 | Haiku 4.5 |
| Best quality | Opus 5 | Opus 5 | Opus 5 |
| Lowest cost | Sonnet 5 | Haiku 4.5 | Haiku 4.5 |

### ⚠️ Security note

In live mode the API key is stored in your browser and calls go straight from the page
to `api.anthropic.com`. That's fine for **personal / family use on your own machine**.

**Do not put this app on a public website as-is** — anyone who visits could use your
key. Publishing it safely means adding a small backend that holds the key and proxies
the requests. That's on the roadmap.

## Project layout

```
serve.ps1            local dev server (Windows PowerShell, no dependencies)
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
data/samples/        demo sets + scripted tutor (demo mode)
vendor/              pdf.js, KaTeX, canvas-confetti (committed, no npm)
```

## Roadmap

- Voice chat — talk through problems out loud
- Accounts & sync — use StudyBuddy on any device
- Parent / teacher view — assign work and track progress
- Share assignment sets with a friend
- A backend key proxy so it can be safely hosted

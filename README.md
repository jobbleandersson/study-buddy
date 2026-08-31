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

- **Menu** — `Assignments` and `Tests` tabs, subject filter chips, a card grid with a
  mastery ring per set.
- **Session** — one question at a time on the left, an **adaptive tutor** chat on the
  right. Four question types: multiple choice, short written answer, flashcard, and
  worked (step-by-step) problems.
- **Results** — animated score ring, per-topic mastery change, and confetti for a
  score of 80%+.
- **Progress** — study streak, mastery meter per subject, and a spaced-repetition
  "due for review" list (SM-2-lite).
- **Create** — generate a new set from your own material: paste text, upload a PDF
  (text is extracted locally), upload a photo, or just type a topic. Review and edit
  every question before saving.

Everything (assignments, attempts, progress) is stored in your browser's
`localStorage`. Settings → **Export JSON** makes a backup.

## Demo mode vs. live mode

Without a Claude API key, StudyBuddy runs in **demo mode**: the two sample sets
(Photosynthesis Basics, Ancient Rome Quiz) are fully playable and the tutor follows a
scripted hint ladder.

Add a key in **Settings** to turn on **live mode**: real question generation from your
material, a real streaming tutor, and AI grading of written answers. Choose the model
(Opus 5 / Sonnet 5 / Haiku 4.5) there too.

### ⚠️ Security note

In live mode the API key is stored in your browser and calls go straight from the page
to `api.anthropic.com`. That's fine for **personal / family use on your own machine**.

**Do not put this app on a public website as-is** — anyone who visits could use your
key. Publishing it safely means adding a small backend that holds the key and proxies
the requests. That's on the roadmap.

## Project layout

```
serve.ps1            local dev server (Windows PowerShell, no dependencies)
index.html           shell — loads fonts, vendored libs, and js/main.js
css/tokens.css       design tokens (colors, type, spacing, motion)
css/app.css          layout + components
js/main.js           hash router + app shell
js/store.js          localStorage state, with a migrate() seam for future accounts
js/claude.js         Claude API client (generate / grade / stream)
js/prompts.js        system prompts + the question JSON shape
js/material.js       paste / PDF / image / topic -> generation inputs
js/views/            one file per screen
js/components/        question renderers, tutor chat, mascot
js/lib/              srs, mastery, markdown, dom helpers, confetti
data/samples/        sample sets + scripted tutor (demo mode)
vendor/              pdf.js, KaTeX, canvas-confetti (committed, no npm)
```

## Roadmap

- Voice chat — talk through problems out loud
- Accounts & sync — use StudyBuddy on any device
- Parent / teacher view — assign work and track progress
- Share assignment sets with a friend
- A backend key proxy so it can be safely hosted

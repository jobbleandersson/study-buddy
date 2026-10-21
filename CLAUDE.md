# PluggEra (repo: study-buddy)

PluggEra, live at pluggera.se, is a study app for Swedish students (åk 7 to gymnasiet, plus högskoleprovet): ready-made practice sets, an AI tutor and spaced repetition. The frontend is plain ES modules (no framework, no build step). A small Express + SQLite server in `server/` serves it and the `/api`. Swedish is the default language, English the second. It runs on Fly as the app `studybuddy-jobble`.

The product name is **PluggEra**. Internal names stay as they are (`study-buddy`, `studify-*` cache and storage keys, `studify.*` localStorage): renaming them would wipe users' saved data.

## How we work

Several Claude sessions, plus the cloud sessions of a second developer, work on this repo at the same time. Each rule here exists because things went wrong without it.

1. **Never switch branches in the shared checkout.** Other sessions commit there. Do all branch work in a worktree: `git worktree add ../study-buddy-<topic> -b <branch> origin/main`, work only inside it, remove it after the merge. Reading git state in the shared checkout is fine.
2. **Branch, PR, green CI, merge, then deploy `main`.** No direct pushes to `main`. Never deploy a branch that isn't merged: the next deploy of `main` silently removes it.
3. **CI red means fix it, without waiting to be told.** Read the failing step's log, fix the cause, push, recheck. Never skip or delete a test to get green. Don't sit in a polling loop.
4. **One deploy at a time, from a clean copy of `origin/main`** (a dedicated worktree, never a feature branch): `flyctl deploy -a studybuddy-jobble --remote-only`. No local Docker needed. Tell other sessions before you start and when you're done. After it: check `https://pluggera.se/api/health` and that your change is in the served files.
5. Cloud sessions can't run `flyctl`. They open PRs; a local session merges and deploys.
6. **Ask first for anything hard to undo or that touches production data or secrets:** deleting or overwriting data, `fly secrets set/unset`, changing the site password or admin keys, force-pushing, switching billing on. Secrets never go in the repo, a PR, a commit message or chat. Refer to them by name only.
7. Keep PRs to one purpose, match the code around your change, and say in the PR how you verified it.
8. **Review before you merge, with Anthropic's skills.** Merging needs no human review, so these stand in for one:
   - `/security-review` on every PR that touches accounts, sign-in, `gate.js`, billing, email, the AI endpoints, uploads, the admin pages or keys, the reviews and error-report endpoints, `state-digest.js`, or anything else that stores or shows student data. Only those: skip it for CSS-only, layout and copy PRs, and batch it when several PRs touch the same sensitive area. Never skip it for a PR on the list.
   - `/code-review` on every PR before it is merged, whatever its size, at medium for tiny, CSS-only or copy-only PRs and high for logic, prompts, security and student data. Fix what it finds, push and recheck CI. If you use `--fix`, read its diff and keep it to the PR's purpose (rule 7).
   - List what you ran, and what came out, in the PR description (the PR template has a spot for it). If the PR doesn't say, the session that merges it runs them first. Cloud sessions that can't run a skill say so in the PR.
9. **Writing code that calls the Anthropic API** (the AI tutor, `ai-check.js`, model IDs, prompts, caching): use the `/claude-api` skill while you write it, and take model IDs from the skill, never from memory.
10. **Keep usage low** (one Pro plan pays for every session; each tool call re-reads the whole context, so long sessions and big tool output are what drain it):
   - Message another session only when it blocks them (the deploy lane, a conflict, a hand-off the user asked for). No status updates or acknowledgements; PR numbers and notes go in the PR description.
   - Check UI with DOM and computed values first and return only a few numbers from `javascript_tool`, never big DOM or JSON dumps. Screenshots only when the layout is the question, at about 0.4-0.6 scale or zoomed to a region, and not several in one batch.
   - Fewer worktree hops inside one session: each change of working directory re-injects this file.

## Run and test

- The Node version is in `.node-version`. First time only: `cd server && npm ci`.
- `npm test` (about 30 seconds) runs `validate` (library and högskoleprov content), `test:unit` (`test/lib`) and `test:server` (`server/test`, a real server with a fake email inbox). Run it before you open a PR. CI runs the same.
- A test that fails sometimes is a bug. Reproduce it by running it repeatedly instead of re-running until it's green.
- Check UI changes in a browser (DOM and computed styles), not just by reading the code. `serve.ps1` serves the static frontend without the API, so signed-in screens need mocked data. `.claude/launch.json` holds preview configs: don't commit local edits to it.

## Things that break if you don't know them

**Frontend**
- **Strings:** all UI text lives in `js/lib/strings.sv.js` and `strings.en.js` with identical keys; a test enforces it. Keep the Swedish short and plain. Use `plural()` for counts.
- **Service worker:** never write a cache version by hand. `sw.js` holds a placeholder and the server fills in a hash of the files it lists. A new module under `js/` must be added to `APP_SHELL` in `sw.js`, or the `sw-shell` test fails.
- **No regex lookbehind** anywhere under `js/` (older Safari). A test enforces it.
- **`el()`** (`js/lib/dom.js`): multiple classes are `"div.a.b"`, never `"div.a b"`. Strings become text nodes. The `html:` option is raw, so only use it with content you control.
- **CSS:** `tokens.css` (the light, paper and dark themes), then `app.css`, then `design.css`, which wins over `app.css` at equal specificity, then `landing.css` (front pages only). Use colour tokens, never hex, so every theme works. A rule that colours `.sidebar__link svg` also hits any icon you add there, so check the computed style.
- **State** (`js/store.js`): one JSON blob, synced to the server. Add fields as optional and additive. Bump `SCHEMA_VERSION` and add a `migrate()` block only when the shape really changes.

**Server**
- **The site is behind a shared password** (`SITE_PASSWORD`, `server/src/gate.js`). Every `/api` request without the cookie gets 403 `site_locked`. A new endpoint that must be public (a webhook, a monitor, a public read) has to be added to the allow-lists in `gate.js`, or it works locally and fails in production. `/api/health` and the approved-reviews list are open on purpose.
- **The state blob is whatever the client sent.** Anything the server shows to other users (names, pictures) must be validated again on the server before it goes out (see `server/src/state-digest.js`, which re-checks friends' pictures).
- **Email** goes through Resend (`server/src/email.js`). Alerts to the owner (`alerts.js`) are rate-limited: keep them so, and never put a student's email address or a request body in one.
- **Billing** (Stripe, `billing.js`) is built but **off**: no Stripe secrets are set. Test mode only. No live keys and no real charges until the owner says it's go-live. Don't write "free forever" in any copy; a paid plan is planned.
- Every endpoint gets a server test. `server/test/harness.mjs` starts a real server with a fake Resend inbox.

## Content and privacy

- The library is `data/library/*.json`, with English in `data/library-en/`. `npm run validate` checks it, and a set needs both languages. Questions must be factually correct; don't invent content.
- Users include minors. Add no third-party script, tracker or SDK, and nothing that identifies a student, without a matching line in the privacy text (the `privacy.*` strings) and the owner's OK. Pageview and error reports are anonymous by design. Keep them that way.

## Where things are

- `js/main.js` is the router, nav and shell. `js/views/` has one file per screen, `js/components/` the reusable UI, `js/lib/` the pure logic (most of the unit tests), `js/store.js` the state, `css/` the styles.
- `server/src/index.js` wires the server. `routes/` has one file per area. Also `gate.js`, `email.js`, `alerts.js`, `billing.js`, `ai-check.js`, `sw-build.js`.
- `HOSTING-FLYIO.md` covers Fly setup, secret names, the custom domain, and the alerts and uptime monitor. The admin pages (`#/admin/reviews`, `#/admin/errors`) use a key held in Fly secrets; never paste it anywhere.

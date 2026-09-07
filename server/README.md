# study-buddy-server

Serves the whole StudyBuddy app — the static frontend (everything one level up:
`index.html`, `css/`, `js/`, etc.) and the API — from one Express process. Holds
the Claude API key and proxies `/api/messages` to Anthropic (the key never
reaches the browser); optional accounts and sync (email/password auth, one JSON
blob per user in SQLite, mirroring what `js/store.js` already keeps in
`localStorage`); and optional parent/teacher linking (invite-code based) with
read-only progress access and set assignment for linked students.

## Run it

```bash
cd server
npm install
cp .env.example .env   # optionally fill in ANTHROPIC_API_KEY for live mode
npm start
```

Open `http://localhost:8787` — that's the whole app, frontend included. A
`studybuddy.sqlite3` file is created alongside `server/` on first run.

Anything under `/server/...` is explicitly blocked from the static file serving
(and dotfiles like `.env` are ignored by default too) — so `.env`, the sqlite
db, and `node_modules` never become fetchable, even though they live inside
the served directory tree.

If the frontend is ever hosted separately from this server again (e.g. GitHub
Pages), set `js/config.js`'s `SERVER_ORIGIN` back to this server's absolute URL
and set `ALLOWED_ORIGIN` below so CORS allows it.

## Routes

- `GET /api/health` — `{ok, keyConfigured}`
- `POST /api/messages` — proxies to Anthropic (streaming passthrough for the tutor).
  Requires a signed-in session by default (`MESSAGES_REQUIRE_AUTH`); enforces a
  per-user request rate limit and a per-user monthly token budget; clamps
  `max_tokens` and rejects unknown models; obeys the `PROXY_DISABLED` kill switch.
  Its own failures carry a machine `code` in `error.code` (`not_authenticated`,
  `rate_limited`, `quota_exceeded`, `maintenance`, `model_not_allowed`).
- `GET /api/usage` — the signed-in user's Claude token spend this month:
  `{period, used, limit, requests, resetsAt, metered}`
- `POST /api/auth/signup`, `/login`, `/logout`, `GET /api/auth/me` — email/password,
  httpOnly session cookie
- `GET/PUT /api/state` — the signed-in user's synced state blob (requires auth);
  `PUT` takes `{version, blob}` and returns `409` with the current version/blob on
  a stale write
- `POST /api/links/invite-code` — the signed-in user generates a 6-character code,
  valid 30 minutes, usable once
- `POST /api/links/redeem {code}` — the signed-in user redeems someone else's code,
  creating an active link where they're the parent/teacher and the code's owner is
  the student
- `GET /api/links` — the signed-in user's links in both directions:
  `{asParent: [...], asStudent: [...]}`
- `DELETE /api/links/:linkId` — either side of a link can remove it
- `POST /api/assigned {studentUserId, doc, dueAt?}` — assign a set (same doc shape
  `generateAssignment()`/`addAssignmentDoc()` use) to a linked student; requires an
  active link to that student
- `GET /api/assigned-for-me` — the signed-in user's pending assigned sets
- `DELETE /api/assigned/:id` — the student clears one from their queue (after importing it)
- `GET /api/parent/students/:studentUserId/state` — read-only: a linked student's
  synced blob, for the parent/teacher dashboard; requires an active link

## Before hosting this somewhere public

`/api/messages` now requires a signed-in session (`MESSAGES_REQUIRE_AUTH=true`, the
default) and meters every request against a per-user monthly token budget, so the key
is no longer spendable anonymously. Still open before a paid launch (see the "Turning
on live mode" plan): there's no **entitlement** check yet — any signed-in account can
spend up to the flat budget, paid or not; login has no throttle; there's no password
reset; the rate limiter and budget counter are per-process, so a multi-process deploy
needs shared state (Redis) and a single owner for the hourly row sweep (`src/sweep.js`).
`COOKIE_SECURE` should be `true` once this runs over https (left `false` for local http
dev). `ALLOWED_ORIGIN` only matters if the frontend is served
from somewhere other than this same process — normally leave it unset.

# Hosting Studify on Fly.io — no GitHub in the deploy path

Replaces the Render setup. GitHub still holds the code and is still how the
two of you share it — that part doesn't go away — but **deploying is a
command you run yourself, not something that happens automatically when you
push.** That trade-off was the point: no GitHub Actions, no SSH keys, no
webhook to wire up. You type one command when you want the live site to catch
up to what you just pushed.

**Cost:** roughly **$4–6/month** — a small always-on machine (~$3.30–5.90
depending on size) plus a sliver for the database's persistent disk (~$0.15).
Custom domain + HTTPS are free, no separate charge.

**What you get at the end:** one app on Fly running the whole thing — frontend
+ `/api/*` — reachable at a `.fly.dev` address immediately, and at your own
domain once you have one. Private while you test: the same `SITE_PASSWORD`
login-prompt gate as before, unchanged.

## 0. Before you start

Install the Fly CLI (`flyctl`) — both of you, each on your own machine:

```powershell
# Windows (PowerShell) — you
pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"
```

```bash
# macOS / Linux — your friend
curl -L https://fly.io/install.sh | sh
```

Then each of you: `fly auth signup` (first time) or `fly auth login`.

## 1. Create the app (once, by whichever of you is paying)

From the repo root, on your machine:

```bash
fly apps create
```

It'll suggest a name or let you type one (Fly app names are global, so
"studybuddy" is likely taken — `studybuddy-<something>` usually isn't). Open
`fly.toml` and replace `CHANGE-ME-studybuddy` on the `app = ` line with
whatever name it gave you.

## 2. Create the persistent disk (once)

This is where the SQLite database file lives, so it survives every future
deploy — the exact thing that reset the database on every deploy on Render's
free tier.

```bash
fly volumes create studybuddy_data -r ams -s 1
```

(`ams` = Amsterdam, the closest major Fly region to Sweden — matches
`fly.toml`'s `primary_region`. `-s 1` = 1 GB, already far more than a SQLite
file needs.)

## 3. Set the real secrets

Never go in `fly.toml` (that's committed to git) — these are encrypted and
set separately:

```bash
fly secrets set ANTHROPIC_API_KEY=sk-ant-...
fly secrets set SITE_PASSWORD=pick-something
```

**`SITE_PASSWORD` is the "private while we test" part.** Once set, every page
(except `/api/*`, so the app itself still works) asks for a username (anything)
and that password before showing anything — a plain browser login prompt, not
a paywall. Share the password only with people you want testing it. Unset it
later (`fly secrets unset SITE_PASSWORD`) when you're ready to actually publish.

### Optional: Sign in with Google

1. [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → **OAuth consent screen**: External, add app name + support email, then **Publish app** (otherwise only test users can sign in).
2. **Credentials → Create credentials → OAuth client ID → Web application.** Under *Authorized JavaScript origins* add `https://studybuddy-jobble.fly.dev` (and `http://localhost:8787` for local dev). No redirect URIs are needed.
3. Copy the Client ID (it is public, not a secret) and set it:

```bash
fly secrets set GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
```

The Google button then appears on the sign-in screen. Unset = no button. A Google sign-in whose email already has a password account links to it and switches that account to Google-only sign-in.

### Approving reviews

Students write reviews at `#/rate`; none show on the front page until someone approves them at
`https://studybuddy-jobble.fly.dev/#/admin/reviews`. That page asks for a key, which you pick once
and set here (anything long and random — both of you use the same one):

```bash
fly secrets set REVIEW_ADMIN_KEY=$(openssl rand -hex 24)
fly secrets list   # shows it's set, not the value, so save it somewhere safe first
```

Unset = nobody can approve, and the page says so. To rotate it, set a new value.

## 4. Deploy

```bash
fly deploy
```

This builds the Docker image (using the `Dockerfile` already in the repo —
it's set up to compile `better-sqlite3` the same way that fixed the segfault
on Render) and ships it. Takes a couple of minutes the first time.

```bash
fly status              # shows the app's URL, something like studybuddy-xxxx.fly.dev
curl -i https://YOUR-APP.fly.dev/api/health   # expect {"ok":true,...}
```

Visit the `.fly.dev` URL — you should see the login prompt from step 3, then
the app.

## 5. Add your friend

```bash
fly orgs invite <your-personal-org-slug> friend@email.com
```

(Find your org slug with `fly orgs list` — usually your Fly username.) They
accept the email invite, then from their own clone of the repo:

```bash
fly deploy
```

...just works, using the `fly.toml` already in the repo — they don't create
anything new, they're deploying to the same app you made in step 1.

## 6. Custom domain

Once you have a domain:

```bash
fly certs add yourdomain.com
```

It prints the DNS records to add (A/AAAA, or a CNAME for something like
`www`). Add those at your domain registrar, wait for DNS to propagate
(minutes to a couple hours), and Fly issues and renews the HTTPS certificate
automatically — no certbot, no manual renewal, ever.

## Day to day, from here on

1. Edit the code, either of you.
2. `git push` to `main` — same as always, for history/backup/review.
3. Whoever made the change runs `fly deploy` from their own machine.
4. The live site is caught up within about a minute.

Nobody needs to touch anything else for a normal change. `fly.toml` and the
`Dockerfile` only need edits if the app's actual setup changes (a new env
var, a bigger machine).

## Rolling back a bad deploy

```bash
git log --oneline -5     # find the last good commit
git checkout <that-commit>
fly deploy
git checkout main        # back to the tip once you're done
```

## Checking in on it

```bash
fly status               # is it running, what's the URL
fly logs                 # live server logs
fly ssh console          # a shell inside the running machine, if you ever need one
```

## Files this setup added

- `Dockerfile` — how the app gets built into a deployable image
- `.dockerignore` — keeps your local `server/.env` (real API key) and the
  database file out of every build, on purpose
- `fly.toml` — the app's Fly configuration (region, disk, always-on setting)

`render.yaml` has been removed — this replaces the Render setup rather than
running alongside it.

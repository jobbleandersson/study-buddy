# StudyBuddy, packaged for Fly.io. One image serves the static frontend
# (index.html, css/, js/, data/, vendor/) AND the /api/* backend from one
# Express process (server/src/index.js) — same shape as running `npm start`
# in server/ locally, just containerized.
#
# Debian ("bookworm-slim"), not Alpine — deliberately. better-sqlite3 is a
# native module; Render's free tier proved a prebuilt binary can segfault
# against the wrong C library, and Alpine's musl libc is the other classic
# way to hit that same class of bug. Debian's glibc + building from source
# below sidesteps it again.
#
# Node 24 (Active LTS to April 2028). Node 20 stopped getting security patches on 30 April 2026, and
# better-sqlite3 only builds on Node 24 from 12.0 on (server/package.json). Keep .node-version
# (which CI runs on) in step with this line.
FROM node:24-bookworm-slim

# Build tools better-sqlite3 needs to compile from source.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first, so this layer is cached across builds unless
# server/package.json or its lockfile changes. `npm ci` installs exactly what
# server/package-lock.json says (and fails if it doesn't match package.json),
# so a deploy never picks up a newer release of anything by itself.
COPY server/package.json server/package-lock.json server/
RUN cd server && npm_config_build_from_source=true npm ci --omit=dev

# Now the rest of the app: frontend + server source.
COPY . .

ENV NODE_ENV=production
EXPOSE 8787
CMD ["node", "server/src/index.js"]

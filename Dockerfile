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
FROM node:20-bookworm-slim

# Build tools better-sqlite3 needs to compile from source.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first, so this layer is cached across builds unless
# server/package.json itself changes. (No server/package-lock.json on
# purpose — see server/package.json's better-sqlite3 pin — so this is
# `npm install`, not `npm ci`.)
COPY server/package.json server/package.json
RUN cd server && npm_config_build_from_source=true npm install --omit=dev

# Now the rest of the app: frontend + server source.
COPY . .

ENV NODE_ENV=production
EXPOSE 8787
CMD ["node", "server/src/index.js"]

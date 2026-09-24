// Cache-Control for static files. None of the app's own files carry a content hash in their name, so
// js/css/html/data keep Express's default: the browser may store them but must ask "still current?" on
// every use, which the ETag answers with an empty 304. A long life would leave people running
// yesterday's code after a deploy. Only files that never change under the same name get one: the
// self-hosted fonts for a year, the vendored libraries (pinned versions, replaced only on purpose)
// for a week. Returns null to keep the default.

import path from "node:path";

const YEAR = 365 * 24 * 60 * 60;
const WEEK = 7 * 24 * 60 * 60;

export function staticCacheControl(filePath) {
  const p = String(filePath).split(path.sep).join("/");
  if (/\/assets\/fonts\/[^/]+\.woff2$/i.test(p)) return `public, max-age=${YEAR}, immutable`;
  if (/\/vendor\/[^/]+\.(js|css)$/i.test(p)) return `public, max-age=${WEEK}`;
  return null;
}

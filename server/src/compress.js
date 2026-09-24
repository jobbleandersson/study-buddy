// Response compression for the static site and the JSON API.
//
// Without it every file goes out raw: the app shell is ~2.7 MB and the library sets another ~9 MB,
// which is what Fly bills as outbound data and what a phone on mobile data waits for. gzip/brotli
// takes text (JS, CSS, HTML, JSON) down to roughly a quarter. The `compression` package only touches
// types that are actually compressible, so already-compressed files (woff2, png) go out untouched.

import compression from "compression";

/** Streaming replies must never be buffered by a compressor: /api/messages forwards the model's
 *  server-sent events chunk by chunk, and a compressor holding chunks back would make the tutor
 *  answer arrive all at once at the end. Everything else uses the package's own compressible-type check. */
export function compressionFilter(req, res) {
  if (String(req.originalUrl || req.url || "").startsWith("/api/messages")) return false;
  if (String(res.getHeader("Content-Type") || "").startsWith("text/event-stream")) return false;
  return compression.filter(req, res);
}

// threshold: below ~1 KB the gzip header costs about what it saves (the package's default, stated here so it is visible).
export const compress = compression({ filter: compressionFilter, threshold: 1024 });

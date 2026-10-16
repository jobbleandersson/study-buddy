// How deeply a JSON document nests, worked out from its raw bytes before anything is built from it.
//
// A saved study state is whatever the client sent. Handing a hostile body of 90,000 nested brackets to
// JSON.stringify later (to store it) overflowed the stack and ended as a 500 plus an alert mail, and
// any recursive reader would do the same. A real state is a handful of levels deep, so a body deeper
// than MAX_STATE_DEPTH is refused up front, with a 400, in a single pass over the bytes.

export const MAX_STATE_DEPTH = 50;

const QUOTE = 0x22, BACKSLASH = 0x5c, OPEN_OBJ = 0x7b, CLOSE_OBJ = 0x7d, OPEN_ARR = 0x5b, CLOSE_ARR = 0x5d;

/** The deepest nesting of {} and [] in a JSON text, ignoring brackets inside strings.
 *  Stops early once it passes `limit`, so a hostile body costs no more than a normal one. */
export function jsonDepth(buf, limit = MAX_STATE_DEPTH) {
  let depth = 0, max = 0, inString = false, escaped = false;
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === BACKSLASH) escaped = true;
      else if (c === QUOTE) inString = false;
      continue;
    }
    if (c === QUOTE) inString = true;
    else if (c === OPEN_OBJ || c === OPEN_ARR) { if (++depth > max) { max = depth; if (max > limit) return max; } }
    else if ((c === CLOSE_OBJ || c === CLOSE_ARR) && depth > 0) depth--;
  }
  return max;
}

/** express.json's `verify` hook: refuse a body nested deeper than the limit (400, not a server error). */
export function assertShallow(_req, _res, buf) {
  if (jsonDepth(buf) > MAX_STATE_DEPTH) {
    const err = new Error("The saved state is nested too deeply.");
    err.status = 400;
    err.type = "state.too.deep";   // a `type` makes index.js's error handler answer 400, not log a 500
    throw err;
  }
}

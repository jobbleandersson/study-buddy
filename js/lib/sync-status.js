// What a failed save to the account means, and when to try again. Kept apart from js/store.js so the rules
// can be tested without a browser.
//
// Until now only a lost connection and a version clash (409) were handled; every other answer (the session
// had ended: 401, the state is too big: 413, the server was restarting: 5xx) was ignored without a word, the
// changes stayed on this device, and nothing ever tried again until the next change or the next start.

/** What the server's answer to a state save means:
 *    ok         saved
 *    conflict   another device saved first (the merge flow handles it)
 *    signedout  the session is gone: sign in again
 *    toolarge   the state is over the server's size limit: retrying cannot help
 *    retry      a hiccup (rate limit, restart, error): try again later */
export function classifyPushStatus(status) {
  if (status >= 200 && status < 300) return "ok";
  if (status === 409) return "conflict";
  if (status === 401) return "signedout";
  if (status === 413) return "toolarge";
  return "retry";
}

export const RETRY_FIRST_MS = 5_000;
export const RETRY_MAX_MS = 5 * 60_000;

/** The wait before the next try after `previousMs` (0 for the first): 5 s, 15 s, 45 s ... at most 5 minutes. */
export function nextRetryDelay(previousMs) {
  if (!(previousMs > 0)) return RETRY_FIRST_MS;
  return Math.min(previousMs * 3, RETRY_MAX_MS);
}

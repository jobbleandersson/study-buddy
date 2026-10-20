// The links that hand over what a code hands over: a class's join link, a student's invitation for a parent or
// teacher, and a friend invitation. A link is the app's own address with the secret after "#/join/": a hash is never sent to the
// server, so the token stays out of server logs and out of the Referer of anything the page loads.

export const JOIN_KINDS = ["class", "parent", "friend"];

/** What a token looks like (the server makes 24 URL-safe characters); anything else is not worth asking the server about. */
export const TOKEN_RX = /^[A-Za-z0-9_-]{20,64}$/;

/** A route with a link's token taken out ("/join/class/<token>" -> "/join/class/:id"), for anything that records where
 *  someone was: the entry pageview and error reports. The token is the secret that makes the link work. The server does
 *  the same to what it is sent (server/src/route-privacy.js), so a report from an old app version is cleaned too. */
export const hideJoinToken = (path) => String(path ?? "").replace(/^(\/join\/(?:class|parent|friend)\/).*$/, "$1:id");

// What the server says when the link itself is the problem: no such invitation, or one that is used up or past its day.
// Anything else it can say (you are asking about your own class, too many tries) is about the person, not the link.
const LINK_PROBLEM = ["This invitation is invalid or has expired.", "Open the link again."];

/** Is this server message (in English, as the server sends it) a sign that the link is broken, so that "ask for a new
 *  link or use a code" is the right thing to tell them? */
export const isBrokenLink = (message) => LINK_PROBLEM.includes(message);

/** The in-app route for a link: "#/join/class/<token>". */
export const joinHash = (kind, token) => `#/join/${kind}/${token}`;

/** The full address to send someone, on whichever address the app is opened from (pluggera.se, a preview, local). */
export function joinUrl(kind, token, loc = globalThis.location) {
  return `${loc.origin}${loc.pathname}${joinHash(kind, token)}`;
}

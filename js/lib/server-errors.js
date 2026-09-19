// The server answers in English with fixed sentences (server/src/routes/*).
// Anything the UI shows from one goes through here so a Swedish visitor gets
// Swedish; a message we don't know passes through unchanged.

import { t } from "./i18n.js";

const KNOWN = {
  "Enter a valid email.": "srv.err.email",
  "Password must be at least 8 characters.": "srv.err.password",
  "An account with that email already exists.": "srv.err.emailTaken",
  "Wrong email or password.": "srv.err.badLogin",
  "Not signed in.": "srv.err.notSignedIn",
  "Session expired.": "srv.err.sessionExpired",
  "Enter a code.": "srv.err.enterCode",
  "That code is invalid or has expired.": "srv.err.badCode",
  "You can't add yourself as a friend.": "srv.err.addSelf",
  "You can't link to your own account.": "srv.err.linkSelf",
  "Friend not found.": "srv.err.friendNotFound",
  "Link not found.": "srv.err.linkNotFound",
  "Not linked to that student.": "srv.err.notLinked",
  "Not found.": "srv.err.notFound",
};

export function serverMessage(message, fallback) {
  const key = KNOWN[message];
  return key ? t(key) : (message || fallback);
}

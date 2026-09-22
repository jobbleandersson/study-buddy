// The server answers in English with fixed sentences (server/src/routes/*).
// Anything the UI shows from one goes through here so a Swedish visitor gets
// Swedish; a message we don't know passes through unchanged.

import { t } from "./i18n.js";

const KNOWN = {
  "Enter a valid email.": "srv.err.email",
  "Password must be at least 8 characters.": "srv.err.password",
  "An account with that email already exists.": "srv.err.emailTaken",
  "Wrong email or password.": "srv.err.badLogin",
  "That request is too large.": "srv.err.tooLarge",
  "Password is too long.": "srv.err.passwordLong",
  "That password is wrong.": "srv.err.deletePassword",
  "That email doesn't match this account.": "srv.err.deleteEmail",
  "Accept the Terms and Privacy Policy to create an account.": "srv.err.consentRequired",
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
  "Enter a class name.": "srv.err.className",
  "Class not found.": "srv.err.classNotFound",
  "You can't join your own class.": "srv.err.joinOwnClass",
  "This class is full.": "srv.err.classFull",
  "You can have up to 20 classes.": "srv.err.classLimit",
  "Pick a set from the library.": "srv.err.pickSet",
  "That date isn't valid.": "srv.err.badDate",
  "That set is already assigned to this class.": "srv.err.alreadyAssigned",
  "This class has too many assignments.": "srv.err.tooManyAssignments",
  "Couldn't create the class. Try again.": "srv.err.classCreate",
  "Pick a valid day.": "srv.err.dailyDay",
  "Pick a day within the next two months.": "srv.err.dailyDayRange",
  "Write the question.": "srv.err.dailyPrompt",
  "Give between 2 and 5 options.": "srv.err.dailyChoices",
  "Fill in every option, or remove the empty ones.": "srv.err.dailyEmptyChoice",
  "Each option must be different.": "srv.err.dailyDupChoice",
  "Mark which option is correct.": "srv.err.dailyAnswer",
  "Someone has already answered that day's question.": "srv.err.dailyAnswered",
  "That day already has a question.": "srv.err.dailyExists",
  "This class has too many questions. Delete some old ones.": "srv.err.dailyTooMany",
  "That question isn't open yet.": "srv.err.dailyNotOpen",
  "Pick one of the options.": "srv.err.dailyPick",
  "You've already answered this one.": "srv.err.dailyAlready",
  "Google sign-in isn't set up on this server.": "srv.err.googleOff",
  "Couldn't verify your Google sign-in.": "srv.err.googleInvalid",
  "Your Google account's email isn't verified.": "srv.err.googleUnverified",
  "Google sign-in is unavailable right now. Try again shortly.": "srv.err.googleUnavailable",
  "That link is invalid or has expired.": "verify.failed",
  "That email is already verified.": "set.acctEmailVerified",
  "Email isn't set up on this server.": "srv.err.emailOff",
  "Too many attempts. Try again in a few minutes.": "srv.err.tooManyAttempts",
};

export function serverMessage(message, fallback) {
  const key = KNOWN[message];
  return key ? t(key) : (message || fallback);
}

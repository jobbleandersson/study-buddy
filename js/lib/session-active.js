// Whether a quiz session is currently on screen. Split out of views/session.js
// (which pulls in the whole quiz-rendering + tutor-chat dependency tree) so
// main.js can check this on every navigation and language switch without
// eagerly loading that tree just for one boolean.
let active = false;
export function isSessionActive() { return active; }
export function setSessionActive(v) { active = v; }

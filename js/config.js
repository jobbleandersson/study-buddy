// Shared constants for talking to the backend (server/). Its own module so
// claude.js and store.js can both use it without an import cycle (claude.js
// already imports store.js).
//
// server/ now serves the frontend itself, so the API is always same-origin —
// no host to hardcode here. If the frontend is ever hosted separately from
// server/ again, set this back to that server's absolute origin.
export const SERVER_ORIGIN = "";

// A leading "/" resolves against the *domain* root, which breaks the moment
// this app is hosted under a subpath (e.g. GitHub Pages' /study-buddy/) —
// every /api/* URL then misses the subpath and hits the wrong place
// entirely. `.` resolves relative to this page's own directory instead, so
// it lands correctly whether that's a domain root (server/ serving the
// frontend itself) or a subpath (GitHub Pages). Only used when
// SERVER_ORIGIN is empty — an absolute origin above already anchors these
// unambiguously.
const API = SERVER_ORIGIN || ".";

export const PROXY_URL = `${API}/api/messages`;
export const PROXY_HEALTH_URL = `${API}/api/health`;
export const USAGE_URL = `${API}/api/usage`;
export const AUTH_SIGNUP_URL = `${API}/api/auth/signup`;
export const AUTH_LOGIN_URL = `${API}/api/auth/login`;
export const AUTH_GOOGLE_URL = `${API}/api/auth/google`;
export const AUTH_LOGOUT_URL = `${API}/api/auth/logout`;
export const AUTH_ME_URL = `${API}/api/auth/me`;
export const ACCOUNT_URL = `${API}/api/account`;
export const RESEND_VERIFICATION_URL = `${API}/api/auth/verify-email/resend`;
export const VERIFY_EMAIL_URL = `${API}/api/auth/verify-email`;
export const FORGOT_PASSWORD_URL = `${API}/api/auth/forgot-password`;
export const RESET_PASSWORD_URL = `${API}/api/auth/reset-password`;

// Where people write with privacy, data and general questions. One place, so it changes in one place.
export const CONTACT_EMAIL = "studifyorganisation@gmail.com";

// The only social link on the front page footer for now — see js/views/landing.js.
export const TIKTOK_URL = "https://www.tiktok.com/@studiduogyu";
export const STATE_URL = `${API}/api/state`;
export const LINKS_URL = `${API}/api/links`;
export const INVITE_CODE_URL = `${API}/api/links/invite-code`;
export const REDEEM_CODE_URL = `${API}/api/links/redeem`;
export const ASSIGNED_FOR_ME_URL = `${API}/api/assigned-for-me`;
export const ASSIGN_URL = `${API}/api/assigned`;
export const studentStateUrl = (studentUserId) => `${API}/api/parent/students/${studentUserId}/state`;
export const unlinkUrl = (linkId) => `${API}/api/links/${linkId}`;
export const clearAssignedUrl = (id) => `${API}/api/assigned/${id}`;

// Friend leaderboard (mutual links, separate from the parent/student ones).
export const FRIEND_INVITE_CODE_URL = `${API}/api/friends/invite-code`;
export const FRIEND_REDEEM_URL = `${API}/api/friends/redeem`;
export const FRIEND_LEADERBOARD_URL = `${API}/api/friends/leaderboard`;
export const unfriendUrl = (linkId) => `${API}/api/friends/${linkId}`;

// Class mode: a teacher's classes, and a student's view of what they've been given.
export const CLASSES_URL = `${API}/api/classes`;
export const CLASS_JOIN_URL = `${API}/api/classes/join`;
export const MY_CLASS_ASSIGNMENTS_URL = `${API}/api/my-class-assignments`;
export const classUrl = (id) => `${API}/api/classes/${id}`;
// Dagens fråga: a teacher writes one question a day for a class; students answer it once.
export const classDailyUrl = (id) => `${API}/api/classes/${id}/daily`;
export const MY_DAILY_URL = `${API}/api/my-daily`;
export const myDailyAnswerUrl = (id) => `${API}/api/my-daily/${id}/answer`;

// No paid plan exists yet — this just joins the waitlist for one (see server/.env.example).
export const WAITLIST_PREMIUM_URL = `${API}/api/waitlist/premium`;

// Anonymous pageview ping (see js/main.js's trackEntryPageview) — measures
// where traffic comes from (e.g. a TikTok bio link's ?utm_source=tiktok)
// without a cookie or a user id.
export const PAGEVIEW_URL = `${API}/api/analytics/pageview`;

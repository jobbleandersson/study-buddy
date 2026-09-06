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
export const AUTH_SIGNUP_URL = `${API}/api/auth/signup`;
export const AUTH_LOGIN_URL = `${API}/api/auth/login`;
export const AUTH_LOGOUT_URL = `${API}/api/auth/logout`;
export const AUTH_ME_URL = `${API}/api/auth/me`;
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

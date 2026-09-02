// Shared constants for talking to the backend (server/). Its own module so
// claude.js and store.js can both use it without an import cycle (claude.js
// already imports store.js).
//
// server/ now serves the frontend itself, so the API is always same-origin —
// no host to hardcode here. If the frontend is ever hosted separately from
// server/ again, set this back to that server's absolute origin.
export const SERVER_ORIGIN = "";

export const PROXY_URL = `${SERVER_ORIGIN}/api/messages`;
export const PROXY_HEALTH_URL = `${SERVER_ORIGIN}/api/health`;
export const AUTH_SIGNUP_URL = `${SERVER_ORIGIN}/api/auth/signup`;
export const AUTH_LOGIN_URL = `${SERVER_ORIGIN}/api/auth/login`;
export const AUTH_LOGOUT_URL = `${SERVER_ORIGIN}/api/auth/logout`;
export const AUTH_ME_URL = `${SERVER_ORIGIN}/api/auth/me`;
export const STATE_URL = `${SERVER_ORIGIN}/api/state`;
export const LINKS_URL = `${SERVER_ORIGIN}/api/links`;
export const INVITE_CODE_URL = `${SERVER_ORIGIN}/api/links/invite-code`;
export const REDEEM_CODE_URL = `${SERVER_ORIGIN}/api/links/redeem`;
export const ASSIGNED_FOR_ME_URL = `${SERVER_ORIGIN}/api/assigned-for-me`;
export const ASSIGN_URL = `${SERVER_ORIGIN}/api/assigned`;
export const studentStateUrl = (studentUserId) => `${SERVER_ORIGIN}/api/parent/students/${studentUserId}/state`;
export const unlinkUrl = (linkId) => `${SERVER_ORIGIN}/api/links/${linkId}`;
export const clearAssignedUrl = (id) => `${SERVER_ORIGIN}/api/assigned/${id}`;

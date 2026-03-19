/**
 * Auth barrel — re-exports everything other modules need.
 */

export { authenticate, authenticateWs, resetApiKeyUserCache, type AuthResult } from './middleware.js';
export { createSession, getSession, deleteSession } from './sessions.js';
export { deriveDefaultPassword, verifyApiKey, parseCookies, sessionCookieHeader, themeCookieHeader, clearSessionCookieHeader } from './crypto.js';
export { verifyUserCredentials } from './credentials.js';
export { checkLoginRateLimit, recordLoginFailure, clearLoginFailures } from './middleware.js';
export { assertAccessToAgent, assertRunBelongsToAgent, assertMessageBelongsToRun, assertAccessToFolder } from './access.js';

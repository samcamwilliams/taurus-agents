/**
 * Auth routes — login, logout, status check.
 */

import { route, json, error, parseBody, type Route } from '../helpers.js';
import {
  AUTH_ENABLED,
  verifyPassword,
  createSession,
  deleteSession,
  getSession,
  parseCookies,
  sessionCookieHeader,
  clearSessionCookieHeader,
  checkLoginRateLimit,
  recordLoginFailure,
  clearLoginFailures,
} from '../auth.js';

export function authRoutes(): Route[] {
  return [
    // Check auth status — always public
    route('GET', '/api/auth/check', async (req, res) => {
      if (!AUTH_ENABLED) {
        return json(res, { authenticated: true, authEnabled: false });
      }

      const cookies = parseCookies(req);
      const sessionToken = cookies.taurus_session;
      if (!sessionToken) {
        return json(res, { authenticated: false, authEnabled: true });
      }

      const session = getSession(sessionToken);
      if (!session) {
        return json(res, { authenticated: false, authEnabled: true });
      }

      return json(res, {
        authenticated: true,
        authEnabled: true,
        csrfToken: session.csrfToken,
      });
    }),

    // Login
    route('POST', '/api/auth/login', async (req, res) => {
      if (!AUTH_ENABLED) {
        return json(res, { ok: true, authEnabled: false });
      }

      // Rate limit by IP
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
        || req.socket.remoteAddress
        || 'unknown';

      if (!checkLoginRateLimit(ip)) {
        return error(res, 'Too many login attempts — try again later', 429);
      }

      const body = await parseBody(req);
      const password = body.password;

      if (!password || typeof password !== 'string') {
        return error(res, 'Password is required', 400);
      }

      if (!verifyPassword(password)) {
        recordLoginFailure(ip);
        return error(res, 'Invalid password', 401);
      }

      clearLoginFailures(ip);
      const session = createSession();

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': sessionCookieHeader(session.token),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
      });
      res.end(JSON.stringify({
        ok: true,
        csrfToken: session.csrfToken,
      }));
    }),

    // Logout
    route('POST', '/api/auth/logout', async (_req, res) => {
      const cookies = parseCookies(_req);
      const sessionToken = cookies.taurus_session;
      if (sessionToken) {
        deleteSession(sessionToken);
      }

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': clearSessionCookieHeader(),
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({ ok: true }));
    }),
  ];
}

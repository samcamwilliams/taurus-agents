/**
 * Request authentication middleware — authenticates HTTP and WebSocket requests.
 *
 * Auth is always on (no AUTH_ENABLED toggle). Returns AuthUser on success.
 * Rate limiting for login attempts lives here too.
 */

import type http from 'node:http';
import type { AuthUser } from '../context.js';
import { verifyApiKey, parseCookies } from './crypto.js';
import { getSession } from './sessions.js';

// ── Public paths (no auth required) ──

const PUBLIC_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/check',
  '/api/health',
]);

// ── Auth result types ──

export type AuthResult =
  | { ok: true; user: AuthUser }
  | { ok: false; status: number; error: string };

// ── Rate limiting ──

const RATE_LIMIT_WINDOW = 60_000;
const RATE_LIMIT_MAX = 5;

interface RateLimitEntry { failures: number[]; }
const rateLimits = new Map<string, RateLimitEntry>();

// Prune stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimits) {
    entry.failures = entry.failures.filter((t) => now - t < RATE_LIMIT_WINDOW);
    if (entry.failures.length === 0) rateLimits.delete(ip);
  }
}, 5 * 60_000).unref();

export function checkLoginRateLimit(ip: string): boolean {
  const entry = rateLimits.get(ip);
  if (!entry) return true;
  const now = Date.now();
  entry.failures = entry.failures.filter((t) => now - t < RATE_LIMIT_WINDOW);
  return entry.failures.length < RATE_LIMIT_MAX;
}

export function recordLoginFailure(ip: string): void {
  let entry = rateLimits.get(ip);
  if (!entry) {
    entry = { failures: [] };
    rateLimits.set(ip, entry);
  }
  entry.failures.push(Date.now());
}

export function clearLoginFailures(ip: string): void {
  rateLimits.delete(ip);
}

// ── Request authentication ──

/**
 * Authenticate an HTTP request. Now async because API key auth needs
 * to look up the admin user to build AuthUser.
 */
export async function authenticate(req: http.IncomingMessage): Promise<AuthResult> {
  const url = new URL(req.url!, 'http://localhost');

  // Public API routes — return a stub user (handler decides what to do)
  if (PUBLIC_PATHS.has(url.pathname)) {
    return { ok: true, user: { id: '', role: 'user', isLoggedIn: true } };
  }

  // Static files — let the SPA load so it can show the login page
  if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/ws/')) {
    return { ok: true, user: { id: '', role: 'user', isLoggedIn: true } };
  }

  // Bearer token (API key or session token)
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);

    if (verifyApiKey(token)) {
      // API key auth — resolve admin user lazily
      const adminUser = await getApiKeyUser();
      if (adminUser) return { ok: true, user: adminUser };
      return { ok: false, status: 401, error: 'No admin user found' };
    }

    const session = getSession(token);
    if (session) {
      return { ok: true, user: { id: session.userId, role: session.role, isLoggedIn: true } };
    }

    return { ok: false, status: 401, error: 'Invalid token' };
  }

  // Session cookie
  const cookies = parseCookies(req);
  const sessionToken = cookies.taurus_session;
  if (!sessionToken) {
    return { ok: false, status: 401, error: 'Not authenticated' };
  }

  const session = getSession(sessionToken);
  if (!session) {
    return { ok: false, status: 401, error: 'Session expired' };
  }

  // CSRF check on mutation requests (cookie-based auth only)
  if (req.method && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const csrfHeader = req.headers['x-csrf-token'] as string | undefined;
    if (csrfHeader !== session.csrfToken) {
      return { ok: false, status: 403, error: 'Invalid CSRF token' };
    }
  }

  return { ok: true, user: { id: session.userId, role: session.role, isLoggedIn: true } };
}

/**
 * Check auth for WebSocket upgrade requests (cookie or query token, no CSRF needed).
 * Returns AuthUser on success, null on failure.
 */
export async function authenticateWs(req: http.IncomingMessage): Promise<AuthUser | null> {
  // Bearer token in query string
  const url = new URL(req.url!, 'http://localhost');
  const token = url.searchParams.get('token');
  if (token) {
    if (verifyApiKey(token)) {
      return await getApiKeyUser() ?? null;
    }
    const session = getSession(token);
    if (session) return { id: session.userId, role: session.role, isLoggedIn: true };
  }

  // Session cookie
  const cookies = parseCookies(req);
  const sessionToken = cookies.taurus_session;
  if (!sessionToken) return null;
  const session = getSession(sessionToken);
  if (!session) return null;
  return { id: session.userId, role: session.role, isLoggedIn: true };
}

// ── API key → admin user resolver ──
// Cached after first lookup to avoid DB hit per request.

let cachedApiKeyUser: AuthUser | null | undefined;

async function getApiKeyUser(): Promise<AuthUser | null> {
  if (cachedApiKeyUser !== undefined) return cachedApiKeyUser;
  try {
    const { default: User } = await import('../../db/models/User.js');
    const admin = await User.findOne({ where: { role: 'admin' } });
    if (admin) {
      cachedApiKeyUser = { id: admin.id, role: 'admin', isLoggedIn: true };
    } else {
      cachedApiKeyUser = null;
    }
  } catch {
    cachedApiKeyUser = null;
  }
  return cachedApiKeyUser;
}

/** Reset the cached API key user (call after creating users). */
export function resetApiKeyUserCache(): void {
  cachedApiKeyUser = undefined;
}

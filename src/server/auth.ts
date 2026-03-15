/**
 * Authentication module — single shared password + session cookies.
 *
 * Enable by setting AUTH_PASSWORD in .env.
 * Optional AUTH_API_KEY for programmatic Bearer token access.
 *
 * Web UI: password login → HttpOnly session cookie + CSRF token
 * API:    Authorization: Bearer <AUTH_API_KEY or session token>
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';

// ── Configuration ──

const AUTH_PASSWORD = process.env.AUTH_PASSWORD;
const AUTH_API_KEY = process.env.AUTH_API_KEY;
const SECURE_COOKIE = process.env.TAURUS_HTTPS === '1';

const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;   // 7 days
const RATE_LIMIT_WINDOW = 60_000;                // 60s
const RATE_LIMIT_MAX = 5;                        // max failed attempts per window

const PUBLIC_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/check',
  '/api/health',
]);

/** True when any auth mechanism is configured. */
export const AUTH_ENABLED = !!(AUTH_PASSWORD || AUTH_API_KEY);

// Warn on misconfiguration: API key without password locks out the web UI
if (AUTH_API_KEY && !AUTH_PASSWORD) {
  console.warn('  Warning: AUTH_API_KEY is set without AUTH_PASSWORD — web UI login will be unavailable');
}

// ── Instance secret + key derivation ──
// Priority: AUTH_SECRET env var > persisted file > auto-generated.
// Purpose-scoped keys derived via HKDF so compromising one doesn't leak others.

function resolveAuthSecret(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;

  const secretPath = path.join(process.cwd(), 'data', '.auth_secret');
  try {
    const existing = fs.readFileSync(secretPath, 'utf-8').trim();
    if (existing) return existing;
  } catch {}

  const generated = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(path.dirname(secretPath), { recursive: true });
    fs.writeFileSync(secretPath, generated + '\n', { mode: 0o600 });
  } catch {}
  return generated;
}

const AUTH_SECRET = resolveAuthSecret();

function deriveKey(purpose: string): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', AUTH_SECRET, '', purpose, 32));
}

const PASSWORD_KEY = deriveKey('taurus:password-verify');
const API_KEY_KEY = deriveKey('taurus:api-key-verify');

// ── State ──

interface Session {
  token: string;
  csrfToken: string;
  createdAt: number;
  expiresAt: number;
}

interface RateLimitEntry {
  failures: number[];
}

const sessions = new Map<string, Session>();
const rateLimits = new Map<string, RateLimitEntry>();

// Prune expired sessions every hour
setInterval(() => {
  const now = Date.now();
  for (const [token, s] of sessions) {
    if (now > s.expiresAt) sessions.delete(token);
  }
}, 60 * 60 * 1000).unref();

// Prune stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimits) {
    entry.failures = entry.failures.filter((t) => now - t < RATE_LIMIT_WINDOW);
    if (entry.failures.length === 0) rateLimits.delete(ip);
  }
}, 5 * 60_000).unref();

// ── Sessions ──

export function createSession(): Session {
  const token = crypto.randomBytes(32).toString('hex');
  const csrfToken = crypto.randomBytes(32).toString('hex');
  const session: Session = {
    token,
    csrfToken,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL,
  };
  sessions.set(token, session);
  return session;
}

export function getSession(token: string): Session | undefined {
  const session = sessions.get(token);
  if (!session) return undefined;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return undefined;
  }
  return session;
}

export function deleteSession(token: string): void {
  sessions.delete(token);
}

// ── Rate limiting ──

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

// ── Verification (timing-safe) ──

export function verifyPassword(password: string): boolean {
  if (!AUTH_PASSWORD) return false;
  const a = crypto.createHmac('sha256', PASSWORD_KEY).update(password).digest();
  const b = crypto.createHmac('sha256', PASSWORD_KEY).update(AUTH_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

function verifyApiKey(provided: string): boolean {
  if (!AUTH_API_KEY) return false;
  const a = crypto.createHmac('sha256', API_KEY_KEY).update(provided).digest();
  const b = crypto.createHmac('sha256', API_KEY_KEY).update(AUTH_API_KEY).digest();
  return crypto.timingSafeEqual(a, b);
}

// ── Cookies ──

export function parseCookies(req: http.IncomingMessage): Record<string, string> {
  const cookies: Record<string, string> = {};
  const header = req.headers.cookie;
  if (!header) return cookies;
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

export function sessionCookieHeader(token: string): string {
  const maxAge = Math.floor(SESSION_TTL / 1000);
  let cookie = `taurus_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
  if (SECURE_COOKIE) cookie += '; Secure';
  return cookie;
}

export function clearSessionCookieHeader(): string {
  let cookie = 'taurus_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';
  if (SECURE_COOKIE) cookie += '; Secure';
  return cookie;
}

// ── Request authentication ──

export type AuthResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * Authenticate an HTTP request.
 *
 * - Public paths are always allowed.
 * - Non-API/WS paths (static files) are always allowed (SPA handles login UI).
 * - Bearer token: checked against AUTH_API_KEY and session tokens. No CSRF required.
 * - Session cookie: validated + CSRF check on mutation methods.
 */
export function authenticate(req: http.IncomingMessage): AuthResult {
  if (!AUTH_ENABLED) return { ok: true };

  const url = new URL(req.url!, 'http://localhost');

  // Public API routes
  if (PUBLIC_PATHS.has(url.pathname)) return { ok: true };

  // Static files — let the SPA load so it can show the login page
  if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/ws/')) {
    return { ok: true };
  }

  // Bearer token (API key or session token)
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    if (verifyApiKey(token)) return { ok: true };
    const session = getSession(token);
    if (session) return { ok: true };
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

  return { ok: true };
}

/**
 * Check auth for WebSocket upgrade requests (cookie or query token, no CSRF needed).
 */
export function authenticateWs(req: http.IncomingMessage): boolean {
  if (!AUTH_ENABLED) return true;

  // Bearer token in query string (for WebSocket clients that can't set cookies)
  const url = new URL(req.url!, 'http://localhost');
  const token = url.searchParams.get('token');
  if (token) {
    if (verifyApiKey(token)) return true;
    if (getSession(token)) return true;
  }

  // Session cookie
  const cookies = parseCookies(req);
  const sessionToken = cookies.taurus_session;
  if (!sessionToken) return false;
  return !!getSession(sessionToken);
}

/**
 * Cryptographic primitives — instance secret, key derivation, API key verification, cookies.
 *
 * Moved from the monolithic auth.ts and extended with deriveDefaultPassword().
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';
import { TAURUS_DATA_PATH } from '../../core/config.js';

// ── Configuration ──

const AUTH_API_KEY = process.env.AUTH_API_KEY;
const SECURE_COOKIE = process.env.TAURUS_HTTPS === '1';
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Instance secret + key derivation ──

function resolveAuthSecret(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;

  const secretPath = path.join(TAURUS_DATA_PATH, '.auth_secret');
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

export function deriveKey(purpose: string): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', AUTH_SECRET, '', purpose, 32));
}

const API_KEY_KEY = deriveKey('taurus:api-key-verify');

// ── Default password derivation ──

/** Derives a deterministic default password from the instance secret (human-typeable hex, 20 chars). */
export function deriveDefaultPassword(): string {
  const raw = deriveKey('taurus:default-password');
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let password = '';
  for (let i = 0; i < 12; i++) password += chars[raw[i] % chars.length];
  return password;
}

// ── API key verification (timing-safe) ──

export function verifyApiKey(provided: string): boolean {
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

export function themeCookieHeader(theme: string): string {
  let cookie = `taurus_theme=${encodeURIComponent(theme)}; SameSite=Lax; Path=/; Max-Age=31536000`;
  if (SECURE_COOKIE) cookie += '; Secure';
  return cookie;
}

export function clearSessionCookieHeader(): string {
  let cookie = 'taurus_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';
  if (SECURE_COOKIE) cookie += '; Secure';
  return cookie;
}

/**
 * Session management — CRUD, file-based persistence, cleanup timers.
 *
 * Sessions now include userId and role so the auth middleware can build
 * an AuthUser without a DB lookup on every request.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// ── Types ──

export interface Session {
  token: string;
  csrfToken: string;
  userId: string;
  role: 'admin' | 'user';
  createdAt: number;
  expiresAt: number;
}

// ── State ──

const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const SESSIONS_DIR = path.join(process.cwd(), 'data', 'sessions');

const sessions = new Map<string, Session>();

// ── Persistence helpers ──

function sessionPath(token: string): string {
  return path.join(SESSIONS_DIR, token.slice(0, 2), token);
}

function persistSession(session: Session): void {
  try {
    const p = sessionPath(session.token);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(session), { mode: 0o600 });
  } catch {}
}

function removeSessionFile(token: string): void {
  try {
    fs.unlinkSync(sessionPath(token));
  } catch {}
}

function loadSessions(): void {
  try {
    const buckets = fs.readdirSync(SESSIONS_DIR);
    const now = Date.now();
    for (const bucket of buckets) {
      const bucketPath = path.join(SESSIONS_DIR, bucket);
      let files: string[];
      try { files = fs.readdirSync(bucketPath); } catch { continue; }
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(bucketPath, file), 'utf-8');
          const s: Session = JSON.parse(raw);
          // Skip sessions from before the multi-user upgrade (missing userId)
          if (!s.userId) {
            try { fs.unlinkSync(path.join(bucketPath, file)); } catch {}
            continue;
          }
          if (now < s.expiresAt) {
            sessions.set(s.token, s);
          } else {
            try { fs.unlinkSync(path.join(bucketPath, file)); } catch {}
          }
        } catch {}
      }
    }
  } catch {}
}

// Load persisted sessions on startup
loadSessions();

// Prune expired sessions every hour
setInterval(() => {
  const now = Date.now();
  for (const [token, s] of sessions) {
    if (now > s.expiresAt) {
      sessions.delete(token);
      removeSessionFile(token);
    }
  }
}, 60 * 60 * 1000).unref();

// ── Public API ──

export function createSession(userId: string, role: 'admin' | 'user'): Session {
  const token = crypto.randomBytes(32).toString('hex');
  const csrfToken = crypto.randomBytes(32).toString('hex');
  const session: Session = {
    token,
    csrfToken,
    userId,
    role,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL,
  };
  sessions.set(token, session);
  persistSession(session);
  return session;
}

export function getSession(token: string): Session | undefined {
  const session = sessions.get(token);
  if (!session) return undefined;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    removeSessionFile(token);
    return undefined;
  }
  return session;
}

export function deleteSession(token: string): void {
  sessions.delete(token);
  removeSessionFile(token);
}

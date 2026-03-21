import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSession, getSession, deleteSession } from '../../../../src/server/auth/sessions.js';

describe('sessions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('createSession', () => {
    it('returns a session with all required fields', () => {
      const session = createSession('user-1', 'admin');
      expect(session.token).toBeDefined();
      expect(session.token.length).toBe(64); // 32 bytes hex
      expect(session.csrfToken).toBeDefined();
      expect(session.csrfToken.length).toBe(64);
      expect(session.userId).toBe('user-1');
      expect(session.role).toBe('admin');
      expect(session.createdAt).toBeGreaterThan(0);
      expect(session.expiresAt).toBeGreaterThan(session.createdAt);
    });

    it('generates unique tokens', () => {
      const a = createSession('user-1', 'admin');
      const b = createSession('user-2', 'user');
      expect(a.token).not.toBe(b.token);
      expect(a.csrfToken).not.toBe(b.csrfToken);
    });

    it('sets 7-day expiry', () => {
      const session = createSession('user-1', 'admin');
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      expect(session.expiresAt - session.createdAt).toBe(sevenDays);
    });
  });

  describe('getSession', () => {
    it('retrieves a created session', () => {
      const created = createSession('user-1', 'admin');
      const retrieved = getSession(created.token);
      expect(retrieved).toBeDefined();
      expect(retrieved!.userId).toBe('user-1');
      expect(retrieved!.token).toBe(created.token);
    });

    it('returns undefined for unknown token', () => {
      expect(getSession('nonexistent-token')).toBeUndefined();
    });

    it('returns undefined for expired session', () => {
      const session = createSession('user-1', 'admin');
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      vi.advanceTimersByTime(sevenDays + 1);
      expect(getSession(session.token)).toBeUndefined();
    });

    it('returns session before expiry', () => {
      const session = createSession('user-1', 'admin');
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      vi.advanceTimersByTime(sevenDays - 1000);
      expect(getSession(session.token)).toBeDefined();
    });
  });

  describe('deleteSession', () => {
    it('removes a session', () => {
      const session = createSession('user-1', 'admin');
      deleteSession(session.token);
      expect(getSession(session.token)).toBeUndefined();
    });

    it('does not throw for unknown token', () => {
      expect(() => deleteSession('nonexistent')).not.toThrow();
    });
  });

  describe('multiple sessions', () => {
    it('coexist independently', () => {
      const a = createSession('user-a', 'admin');
      const b = createSession('user-b', 'user');
      expect(getSession(a.token)!.userId).toBe('user-a');
      expect(getSession(b.token)!.userId).toBe('user-b');
      deleteSession(a.token);
      expect(getSession(a.token)).toBeUndefined();
      expect(getSession(b.token)).toBeDefined();
    });
  });
});

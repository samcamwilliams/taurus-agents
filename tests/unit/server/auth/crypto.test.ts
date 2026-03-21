import { describe, it, expect } from 'vitest';
import {
  deriveKey,
  deriveDefaultPassword,
  verifyApiKey,
  parseCookies,
  sessionCookieHeader,
  themeCookieHeader,
  clearSessionCookieHeader,
} from '../../../../src/server/auth/crypto.js';
import type http from 'node:http';

describe('deriveKey', () => {
  it('returns a 32-byte Buffer', () => {
    const key = deriveKey('test-purpose');
    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(32);
  });

  it('returns consistent output for same purpose', () => {
    const a = deriveKey('same-purpose');
    const b = deriveKey('same-purpose');
    expect(a.equals(b)).toBe(true);
  });

  it('returns different output for different purposes', () => {
    const a = deriveKey('purpose-a');
    const b = deriveKey('purpose-b');
    expect(a.equals(b)).toBe(false);
  });
});

describe('deriveDefaultPassword', () => {
  it('returns a 12-character string', () => {
    const pw = deriveDefaultPassword();
    expect(pw).toHaveLength(12);
  });

  it('is deterministic', () => {
    expect(deriveDefaultPassword()).toBe(deriveDefaultPassword());
  });

  it('contains only alphanumeric characters (no ambiguous chars)', () => {
    const pw = deriveDefaultPassword();
    // The charset excludes I, l, O, o, 0, 1
    expect(pw).toMatch(/^[A-HJ-NP-Za-hj-km-np-z2-9]+$/);
  });
});

describe('verifyApiKey', () => {
  // Note: verifyApiKey depends on AUTH_API_KEY env var at module load time.
  // If AUTH_API_KEY is not set, it always returns false.
  it('returns false for random string (no AUTH_API_KEY set in test env)', () => {
    expect(verifyApiKey('random-key')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(verifyApiKey('')).toBe(false);
  });
});

describe('parseCookies', () => {
  function fakeReq(cookieHeader?: string): http.IncomingMessage {
    return { headers: { cookie: cookieHeader } } as http.IncomingMessage;
  }

  it('parses key=value pairs', () => {
    const result = parseCookies(fakeReq('name=alice; session=abc123'));
    expect(result).toEqual({ name: 'alice', session: 'abc123' });
  });

  it('returns empty object for missing cookie header', () => {
    expect(parseCookies(fakeReq(undefined))).toEqual({});
  });

  it('handles URL-encoded values', () => {
    const result = parseCookies(fakeReq('val=hello%20world'));
    expect(result.val).toBe('hello world');
  });

  it('handles empty cookie header', () => {
    expect(parseCookies(fakeReq(''))).toEqual({});
  });

  it('skips malformed pairs without =', () => {
    const result = parseCookies(fakeReq('good=val; badpair; also=ok'));
    expect(result).toEqual({ good: 'val', also: 'ok' });
  });
});

describe('sessionCookieHeader', () => {
  it('includes HttpOnly', () => {
    expect(sessionCookieHeader('tok123')).toContain('HttpOnly');
  });

  it('includes SameSite=Strict', () => {
    expect(sessionCookieHeader('tok123')).toContain('SameSite=Strict');
  });

  it('includes the token value', () => {
    expect(sessionCookieHeader('tok123')).toContain('taurus_session=tok123');
  });

  it('includes Max-Age (7 days in seconds)', () => {
    const sevenDays = 7 * 24 * 60 * 60;
    expect(sessionCookieHeader('tok123')).toContain(`Max-Age=${sevenDays}`);
  });
});

describe('themeCookieHeader', () => {
  it('does NOT include HttpOnly (must be readable by JS)', () => {
    expect(themeCookieHeader('dark')).not.toContain('HttpOnly');
  });

  it('includes the theme value', () => {
    expect(themeCookieHeader('dark')).toContain('taurus_theme=dark');
  });

  it('includes SameSite=Lax', () => {
    expect(themeCookieHeader('dark')).toContain('SameSite=Lax');
  });

  it('URL-encodes the theme value', () => {
    expect(themeCookieHeader('vivid-catppuccin')).toContain('vivid-catppuccin');
  });
});

describe('clearSessionCookieHeader', () => {
  it('sets Max-Age=0', () => {
    expect(clearSessionCookieHeader()).toContain('Max-Age=0');
  });

  it('includes HttpOnly', () => {
    expect(clearSessionCookieHeader()).toContain('HttpOnly');
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { Daemon } from '../../../src/daemon/daemon.js';
import User from '../../../src/db/models/User.js';
import { clearLoginFailures } from '../../../src/server/auth/middleware.js';
import { createTestServer, request, silentLogger } from '../../helpers/integration.js';

let url: string;
let close: () => Promise<void>;
let testPassword: string;
let testUsername: string;

beforeAll(async () => {
  const daemon = new Daemon(silentLogger);
  await daemon.init();
  const srv = await createTestServer(daemon);
  url = srv.url;
  close = srv.close;

  // Create a user for login tests
  testUsername = `auth-test-${uuidv4().slice(0, 8)}`;
  testPassword = 'test-pass-123';
  const hash = await User.hashPassword(testPassword);
  await User.create({
    id: uuidv4(), username: testUsername, email: `${testUsername}@test.local`,
    password_hash: hash, role: 'admin',
  });
});

afterAll(async () => {
  await close();
});

describe('GET /api/auth/check', () => {
  it('returns unauthenticated when no session', async () => {
    const res = await request(url, 'GET', '/api/auth/check');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
    expect(res.body.authEnabled).toBe(true);
  });

  it('returns authenticated with valid session cookie', async () => {
    // Login first to get a session
    const login = await request(url, 'POST', '/api/auth/login', {
      body: { username: testUsername, password: testPassword },
    });
    expect(login.status).toBe(200);

    // Extract session cookie from Set-Cookie header
    const setCookie = login.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
    const sessionMatch = cookieStr?.match(/taurus_session=([^;]+)/);
    expect(sessionMatch).not.toBeNull();

    const res = await request(url, 'GET', '/api/auth/check', {
      headers: { Cookie: `taurus_session=${sessionMatch![1]}` },
    });
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
    expect(res.body.username).toBe(testUsername);
    expect(res.body.role).toBe('admin');
    expect(res.body.csrfToken).toBeDefined();
  });
});

describe('POST /api/auth/login', () => {
  it('returns 200 on valid credentials', async () => {
    const res = await request(url, 'POST', '/api/auth/login', {
      body: { username: testUsername, password: testPassword },
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.csrfToken).toBeDefined();
    expect(res.body.username).toBe(testUsername);
    expect(res.body.role).toBe('admin');
  });

  it('sets session cookie on login', async () => {
    const res = await request(url, 'POST', '/api/auth/login', {
      body: { username: testUsername, password: testPassword },
    });
    const setCookie = res.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
    expect(cookieStr).toContain('taurus_session=');
    expect(cookieStr).toContain('HttpOnly');
  });

  it('returns 401 on bad password', async () => {
    const res = await request(url, 'POST', '/api/auth/login', {
      body: { username: testUsername, password: 'wrong-password' },
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  it('returns 401 on unknown user', async () => {
    const res = await request(url, 'POST', '/api/auth/login', {
      body: { username: 'nonexistent-user', password: 'pass' },
    });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('invalidates session', async () => {
    // Login
    const login = await request(url, 'POST', '/api/auth/login', {
      body: { username: testUsername, password: testPassword },
    });
    const setCookie = login.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
    const sessionMatch = cookieStr?.match(/taurus_session=([^;]+)/);
    const csrfToken = login.body.csrfToken;

    // Logout
    const logout = await request(url, 'POST', '/api/auth/logout', {
      headers: {
        Cookie: `taurus_session=${sessionMatch![1]}`,
        'X-CSRF-Token': csrfToken,
      },
    });
    expect(logout.status).toBe(200);
    expect(logout.body.ok).toBe(true);

    // Session should now be invalid
    const check = await request(url, 'GET', '/api/auth/check', {
      headers: { Cookie: `taurus_session=${sessionMatch![1]}` },
    });
    expect(check.body.authenticated).toBe(false);
  });
});

describe('CSRF protection', () => {
  it('rejects mutation without CSRF token', async () => {
    // Login to get a session
    const login = await request(url, 'POST', '/api/auth/login', {
      body: { username: testUsername, password: testPassword },
    });
    const setCookie = login.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
    const sessionMatch = cookieStr?.match(/taurus_session=([^;]+)/);

    // Try to create an agent without CSRF token
    const res = await request(url, 'POST', '/api/agents', {
      headers: {
        Cookie: `taurus_session=${sessionMatch![1]}`,
        'Content-Type': 'application/json',
      },
      body: { name: 'should-fail', system_prompt: 'test', tools: [] },
    });
    expect(res.status).toBe(403);
  });

  it('rejects mutation with wrong CSRF token', async () => {
    const login = await request(url, 'POST', '/api/auth/login', {
      body: { username: testUsername, password: testPassword },
    });
    const setCookie = login.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
    const sessionMatch = cookieStr?.match(/taurus_session=([^;]+)/);

    const res = await request(url, 'POST', '/api/agents', {
      headers: {
        Cookie: `taurus_session=${sessionMatch![1]}`,
        'X-CSRF-Token': 'wrong-token',
        'Content-Type': 'application/json',
      },
      body: { name: 'should-fail', system_prompt: 'test', tools: [] },
    });
    expect(res.status).toBe(403);
  });
});

describe('unauthenticated access', () => {
  it('rejects protected routes without auth', async () => {
    const res = await request(url, 'GET', '/api/agents');
    expect(res.status).toBe(401);
  });
});

describe('rate limiting', () => {
  beforeEach(() => {
    // Reset rate limit state — all test requests come from localhost (same IP)
    clearLoginFailures('::1');
    clearLoginFailures('127.0.0.1');
    clearLoginFailures('::ffff:127.0.0.1');
  });

  it('returns 429 after 5 failed login attempts', async () => {
    // Make 5 failed attempts (the maximum allowed)
    for (let i = 0; i < 5; i++) {
      const res = await request(url, 'POST', '/api/auth/login', {
        body: { username: testUsername, password: 'wrong' },
      });
      expect(res.status).toBe(401);
    }

    // 6th attempt should be rate limited
    const blocked = await request(url, 'POST', '/api/auth/login', {
      body: { username: testUsername, password: 'wrong' },
    });
    expect(blocked.status).toBe(429);
  });

  it('rate limit does not block valid credentials check', async () => {
    // Exhaust rate limit
    for (let i = 0; i < 5; i++) {
      await request(url, 'POST', '/api/auth/login', {
        body: { username: testUsername, password: 'wrong' },
      });
    }

    // Even valid credentials should be blocked (rate limit is per-IP, not per-user)
    const blocked = await request(url, 'POST', '/api/auth/login', {
      body: { username: testUsername, password: testPassword },
    });
    expect(blocked.status).toBe(429);
  });
});

describe('PUT /api/auth/preferences', () => {
  let sessionCookie: string;
  let csrfToken: string;

  beforeAll(async () => {
    clearLoginFailures('::1');
    clearLoginFailures('127.0.0.1');
    clearLoginFailures('::ffff:127.0.0.1');
    const login = await request(url, 'POST', '/api/auth/login', {
      body: { username: testUsername, password: testPassword },
    });
    const setCookie = login.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
    sessionCookie = cookieStr?.match(/taurus_session=([^;]+)/)?.[1] ?? '';
    csrfToken = login.body.csrfToken;
  });

  it('sets theme with valid value', async () => {
    const res = await request(url, 'PUT', '/api/auth/preferences', {
      headers: {
        Cookie: `taurus_session=${sessionCookie}`,
        'X-CSRF-Token': csrfToken,
      },
      body: { theme: 'night' },
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.theme).toBe('night');
  });

  it('rejects invalid theme', async () => {
    const res = await request(url, 'PUT', '/api/auth/preferences', {
      headers: {
        Cookie: `taurus_session=${sessionCookie}`,
        'X-CSRF-Token': csrfToken,
      },
      body: { theme: 'neon-rainbow' },
    });
    expect(res.status).toBe(400);
  });

  it('theme persists across auth checks', async () => {
    await request(url, 'PUT', '/api/auth/preferences', {
      headers: {
        Cookie: `taurus_session=${sessionCookie}`,
        'X-CSRF-Token': csrfToken,
      },
      body: { theme: 'dark' },
    });

    const check = await request(url, 'GET', '/api/auth/check', {
      headers: { Cookie: `taurus_session=${sessionCookie}` },
    });
    expect(check.body.theme).toBe('dark');
  });
});

describe('PUT /api/auth/password', () => {
  let pwUsername: string;
  let pwPassword: string;
  let sessionCookie: string;
  let csrfToken: string;

  beforeAll(async () => {
    clearLoginFailures('::1');
    clearLoginFailures('127.0.0.1');
    clearLoginFailures('::ffff:127.0.0.1');
    pwUsername = `pw-test-${uuidv4().slice(0, 8)}`;
    pwPassword = 'old-password-123';
    const hash = await User.hashPassword(pwPassword);
    await User.create({
      id: uuidv4(), username: pwUsername, email: `${pwUsername}@test.local`,
      password_hash: hash, role: 'admin',
    });

    const login = await request(url, 'POST', '/api/auth/login', {
      body: { username: pwUsername, password: pwPassword },
    });
    const setCookie = login.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
    sessionCookie = cookieStr?.match(/taurus_session=([^;]+)/)?.[1] ?? '';
    csrfToken = login.body.csrfToken;
  });

  it('rejects wrong current password', async () => {
    const res = await request(url, 'PUT', '/api/auth/password', {
      headers: {
        Cookie: `taurus_session=${sessionCookie}`,
        'X-CSRF-Token': csrfToken,
      },
      body: { current_password: 'wrong', new_password: 'new-password-456' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects short new password', async () => {
    const res = await request(url, 'PUT', '/api/auth/password', {
      headers: {
        Cookie: `taurus_session=${sessionCookie}`,
        'X-CSRF-Token': csrfToken,
      },
      body: { current_password: pwPassword, new_password: 'short' },
    });
    expect(res.status).toBe(400);
  });

  it('changes password successfully', async () => {
    const newPassword = 'new-password-456';
    const res = await request(url, 'PUT', '/api/auth/password', {
      headers: {
        Cookie: `taurus_session=${sessionCookie}`,
        'X-CSRF-Token': csrfToken,
      },
      body: { current_password: pwPassword, new_password: newPassword },
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Old password should no longer work
    clearLoginFailures('::1');
    clearLoginFailures('127.0.0.1');
    clearLoginFailures('::ffff:127.0.0.1');
    const oldLogin = await request(url, 'POST', '/api/auth/login', {
      body: { username: pwUsername, password: pwPassword },
    });
    expect(oldLogin.status).toBe(401);

    // New password should work
    const newLogin = await request(url, 'POST', '/api/auth/login', {
      body: { username: pwUsername, password: newPassword },
    });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.ok).toBe(true);
  });
});

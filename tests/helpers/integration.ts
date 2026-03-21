/**
 * Integration test helpers.
 *
 * These are imported by test files — the setupFile (integration-setup.ts)
 * ensures DB and env are ready before any test runs.
 */

import http from 'node:http';
import { v4 as uuidv4 } from 'uuid';
import { createSession } from '../../src/server/auth/sessions.js';
import User from '../../src/db/models/User.js';
import Folder from '../../src/db/models/Folder.js';
import { createServer } from '../../src/server/server.js';
import type { Daemon } from '../../src/daemon/daemon.js';

export const USE_DOCKER = process.env.TAURUS_TEST_DOCKER === '1';

/**
 * Create a test user with admin role + session, return auth headers.
 */
export async function createTestUser(
  opts: { username?: string; role?: 'admin' | 'user' } = {},
): Promise<{
  userId: string;
  headers: Record<string, string>;
  csrfToken: string;
  sessionToken: string;
}> {
  const username = opts.username ?? `test-${uuidv4().slice(0, 8)}`;
  const role = opts.role ?? 'admin';

  const passwordHash = await User.hashPassword('test-password');
  const user = await User.create({
    id: uuidv4(),
    username,
    email: `${username}@test.local`,
    password_hash: passwordHash,
    role,
  });

  await Folder.ensureRootForUser(user.id);

  const session = createSession(user.id, role);
  return {
    userId: user.id,
    headers: {
      Cookie: `taurus_session=${session.token}`,
      'X-CSRF-Token': session.csrfToken,
      'Content-Type': 'application/json',
    },
    csrfToken: session.csrfToken,
    sessionToken: session.token,
  };
}

/**
 * Boot an HTTP server on a random port. Returns the base URL and a close function.
 */
export async function createTestServer(daemon: Daemon): Promise<{
  url: string;
  server: http.Server;
  close: () => Promise<void>;
}> {
  const server = createServer(daemon, 0);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  return {
    url: `http://localhost:${port}`,
    server,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    }),
  };
}

/**
 * Make an HTTP request to the test server. Returns parsed JSON + status.
 */
export async function request(
  baseUrl: string,
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: any } = {},
): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }> {
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = { ...opts.headers };
  let bodyStr: string | undefined;
  if (opts.body !== undefined) {
    bodyStr = JSON.stringify(opts.body);
    headers['Content-Type'] ??= 'application/json';
  }

  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        let body: any;
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
        resolve({ status: res.statusCode!, body, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/** Silent logger for tests — suppresses daemon console output. */
export const silentLogger = (_level: string, _msg: string) => {};

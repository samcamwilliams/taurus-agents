/**
 * Multi-user API isolation: User A's resources are invisible to User B.
 * The server returns 404 (not 403) for resources owned by other users.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Daemon } from '../../../src/daemon/daemon.js';
import { createTestUser, createTestServer, request, silentLogger } from '../../helpers/integration.js';

let url: string;
let close: () => Promise<void>;

let headersA: Record<string, string>;
let headersB: Record<string, string>;

beforeAll(async () => {
  const daemon = new Daemon(silentLogger);
  await daemon.init();
  const srv = await createTestServer(daemon);
  url = srv.url;
  close = srv.close;

  const userA = await createTestUser({ username: 'iso-user-a' });
  const userB = await createTestUser({ username: 'iso-user-b' });
  headersA = userA.headers;
  headersB = userB.headers;
});

afterAll(async () => {
  await close();
});

describe('agent isolation', () => {
  let agentIdA: string;

  beforeAll(async () => {
    const res = await request(url, 'POST', '/api/agents', {
      headers: headersA,
      body: { name: 'private-agent-a', system_prompt: 'test', tools: [] },
    });
    expect(res.status).toBe(201);
    agentIdA = res.body.id;
  });

  it('User B cannot GET User A agent by ID', async () => {
    const res = await request(url, 'GET', `/api/agents/${agentIdA}`, {
      headers: headersB,
    });
    expect(res.status).toBe(404);
  });

  it('User B cannot DELETE User A agent', async () => {
    const res = await request(url, 'DELETE', `/api/agents/${agentIdA}`, {
      headers: headersB,
    });
    expect(res.status).toBe(404);
  });

  it('User B agent list does not include User A agents', async () => {
    const res = await request(url, 'GET', '/api/agents', {
      headers: headersB,
    });
    expect(res.status).toBe(200);
    const ids = res.body.map((a: any) => a.id);
    expect(ids).not.toContain(agentIdA);
  });
});

describe('folder isolation', () => {
  let folderIdA: string;

  beforeAll(async () => {
    const res = await request(url, 'POST', '/api/folders', {
      headers: headersA,
      body: { name: 'private-folder-a' },
    });
    expect(res.status).toBe(201);
    folderIdA = res.body.id;
  });

  it('User B folder tree does not include User A folders', async () => {
    const res = await request(url, 'GET', '/api/folders', {
      headers: headersB,
    });
    expect(res.status).toBe(200);

    // Flatten tree to find all folder IDs
    const allIds: string[] = [];
    const walk = (nodes: any[]) => {
      for (const n of nodes) {
        allIds.push(n.id);
        if (n.children) walk(n.children);
      }
    };
    walk(Array.isArray(res.body) ? res.body : [res.body]);
    expect(allIds).not.toContain(folderIdA);
  });
});

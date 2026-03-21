import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Daemon } from '../../../src/daemon/daemon.js';
import { createTestUser, createTestServer, request, silentLogger } from '../../helpers/integration.js';

let url: string;
let close: () => Promise<void>;
let headers: Record<string, string>;

beforeAll(async () => {
  const daemon = new Daemon(silentLogger);
  await daemon.init();
  const srv = await createTestServer(daemon);
  url = srv.url;
  close = srv.close;
  const user = await createTestUser();
  headers = user.headers;
});

afterAll(async () => {
  await close();
});

describe('GET /api/folders', () => {
  it('returns folder tree with root', async () => {
    const res = await request(url, 'GET', '/api/folders', { headers });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    // Root folder has no parent
    const root = res.body.find((f: any) => f.parentId === null);
    expect(root).toBeDefined();
    expect(root.name).toBe('root');
  });
});

describe('POST /api/folders', () => {
  it('creates a child folder', async () => {
    const res = await request(url, 'POST', '/api/folders', {
      headers,
      body: { name: 'new-folder' },
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('new-folder');
    expect(res.body.parentId).toBeDefined(); // should be root
    expect(res.body.id).toBeDefined();
  });

  it('creates a folder under a specific parent', async () => {
    // Create parent first
    const parent = await request(url, 'POST', '/api/folders', {
      headers,
      body: { name: 'parent-folder' },
    });

    const child = await request(url, 'POST', '/api/folders', {
      headers,
      body: { name: 'child-folder', parentId: parent.body.id },
    });
    expect(child.status).toBe(201);
    expect(child.body.parentId).toBe(parent.body.id);
  });
});

describe('DELETE /api/folders/:id', () => {
  it('deletes a folder', async () => {
    const folder = await request(url, 'POST', '/api/folders', {
      headers,
      body: { name: 'to-delete' },
    });

    const res = await request(url, 'DELETE', `/api/folders/${folder.body.id}`, { headers });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Should be gone from tree
    const tree = await request(url, 'GET', '/api/folders', { headers });
    const found = tree.body.find((f: any) => f.id === folder.body.id);
    expect(found).toBeUndefined();
  });

  it('cannot delete root folder', async () => {
    const tree = await request(url, 'GET', '/api/folders', { headers });
    const root = tree.body.find((f: any) => f.parentId === null);

    const res = await request(url, 'DELETE', `/api/folders/${root.id}`, { headers });
    expect(res.status).toBe(400);
  });
});

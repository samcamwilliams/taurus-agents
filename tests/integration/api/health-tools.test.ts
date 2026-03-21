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

describe('GET /api/health', () => {
  it('returns ok status (no auth required)', async () => {
    const res = await request(url, 'GET', '/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
  });
});

describe('GET /api/tools', () => {
  it('returns tool catalog and defaults', async () => {
    const res = await request(url, 'GET', '/api/tools', { headers });
    expect(res.status).toBe(200);
    expect(res.body.tools).toBeDefined();
    expect(Array.isArray(res.body.tools)).toBe(true);
    expect(res.body.tools.length).toBeGreaterThan(0);
    expect(res.body.defaults).toBeDefined();
    expect(res.body.defaults.model).toBeDefined();
    expect(res.body.defaults.docker_image).toBe('taurus-base');
  });

  it('each tool has name, group, description', async () => {
    const res = await request(url, 'GET', '/api/tools', { headers });
    for (const tool of res.body.tools) {
      expect(tool.name).toBeDefined();
      expect(tool.group).toBeDefined();
      expect(tool.description).toBeDefined();
    }
  });
});

describe('GET /api/models', () => {
  it('returns model data', async () => {
    const res = await request(url, 'GET', '/api/models', { headers });
    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
  });
});

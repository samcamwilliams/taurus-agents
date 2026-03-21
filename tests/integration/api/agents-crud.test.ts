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

describe('POST /api/agents', () => {
  it('creates an agent with minimal fields', async () => {
    const res = await request(url, 'POST', '/api/agents', {
      headers,
      body: {
        name: 'test-create',
        system_prompt: 'You are helpful.',
        tools: ['Read', 'Glob'],
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('test-create');
    expect(res.body.tools).toEqual(['Read', 'Glob']);
    expect(res.body.status).toBe('idle');
    expect(res.body.docker_image).toBe('taurus-base');
  });

  it('creates an agent with all optional fields', async () => {
    const res = await request(url, 'POST', '/api/agents', {
      headers,
      body: {
        name: 'test-full',
        system_prompt: 'Full test',
        tools: ['Read', 'Glob', 'Bash'],
        model: 'anthropic/claude-sonnet-4-20250514',
        max_turns: 10,
        timeout_ms: 60000,
        metadata: { purpose: 'testing' },
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.model).toBe('anthropic/claude-sonnet-4-20250514');
    expect(res.body.max_turns).toBe(10);
    expect(res.body.timeout_ms).toBe(60000);
    expect(res.body.metadata).toEqual({ purpose: 'testing' });
  });

  it('returns 400 on missing required fields', async () => {
    const res = await request(url, 'POST', '/api/agents', {
      headers,
      body: { name: 'no-prompt' },
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/agents', () => {
  it('lists agents for the user', async () => {
    const res = await request(url, 'GET', '/api/agents', { headers });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].name).toBeDefined();
  });
});

describe('GET /api/agents/:id', () => {
  it('returns a single agent by ID', async () => {
    const create = await request(url, 'POST', '/api/agents', {
      headers,
      body: { name: 'get-test', system_prompt: 'test', tools: [] },
    });
    const agentId = create.body.id;

    const res = await request(url, 'GET', `/api/agents/${agentId}`, { headers });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(agentId);
    expect(res.body.name).toBe('get-test');
  });

  it('returns 404 for nonexistent ID', async () => {
    const res = await request(url, 'GET', '/api/agents/00000000-0000-0000-0000-000000000000', { headers });
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/agents/:id', () => {
  it('updates agent fields', async () => {
    const create = await request(url, 'POST', '/api/agents', {
      headers,
      body: { name: 'update-test', system_prompt: 'old', tools: [] },
    });
    const agentId = create.body.id;

    const res = await request(url, 'PUT', `/api/agents/${agentId}`, {
      headers,
      body: { system_prompt: 'new prompt', tools: ['Bash'] },
    });
    expect(res.status).toBe(200);
    expect(res.body.system_prompt).toBe('new prompt');
    expect(res.body.tools).toEqual(['Bash']);
  });
});

describe('DELETE /api/agents/:id', () => {
  it('deletes an agent', async () => {
    const create = await request(url, 'POST', '/api/agents', {
      headers,
      body: { name: 'delete-test', system_prompt: 'test', tools: [] },
    });
    const agentId = create.body.id;

    const res = await request(url, 'DELETE', `/api/agents/${agentId}`, { headers });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Should no longer be findable
    const get = await request(url, 'GET', `/api/agents/${agentId}`, { headers });
    expect(get.status).toBe(404);
  });
});

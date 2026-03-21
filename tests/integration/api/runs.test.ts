/**
 * Tests for run-related API endpoints.
 *
 * Runs and messages are seeded directly via the ORM because starting a run
 * (POST /agents/:id/run) forks a worker process and needs Docker — both
 * unavailable in the default test environment. The full agent loop is tested
 * separately in tests/integration/loop/ using agentLoop() directly with
 * MockInferenceProvider.
 *
 * The POST /agents/:id/run endpoint is tested here only for validation and
 * error paths that don't require a working Docker daemon.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { Daemon } from '../../../src/daemon/daemon.js';
import Agent from '../../../src/db/models/Agent.js';
import Run from '../../../src/db/models/Run.js';
import { createTestUser, createTestServer, request, silentLogger } from '../../helpers/integration.js';

let url: string;
let close: () => Promise<void>;
let headers: Record<string, string>;
let userId: string;
let agentId: string;

beforeAll(async () => {
  const daemon = new Daemon(silentLogger);
  await daemon.init();
  const srv = await createTestServer(daemon);
  url = srv.url;
  close = srv.close;

  const user = await createTestUser();
  headers = user.headers;
  userId = user.userId;

  // Create an agent via API and seed some runs + messages directly via DB
  const createRes = await request(url, 'POST', '/api/agents', {
    headers,
    body: { name: 'run-test-agent', system_prompt: 'test', tools: [] },
  });
  agentId = createRes.body.id;

  // Create runs directly in DB (since we can't fork workers in tests)
  const run1 = await Run.create({
    id: uuidv4(), agent_id: agentId, cwd: '/workspace', status: 'completed',
    run_summary: 'First run done', total_input_tokens: 100, total_output_tokens: 50,
  });
  await run1.persistMessage('user', 'hello');
  await run1.persistMessage('assistant', [{ type: 'text', text: 'hi there' }], {
    stopReason: 'end_turn', inputTokens: 50, outputTokens: 25,
  });

  const run2 = await Run.create({
    id: uuidv4(), agent_id: agentId, cwd: '/workspace', status: 'completed',
    run_summary: 'Second run done',
  });
  await run2.persistMessage('user', 'another message');
});

afterAll(async () => {
  await close();
});

describe('POST /api/agents/:id/run', () => {
  it('returns 404 for unknown agent', async () => {
    const res = await request(url, 'POST', `/api/agents/${uuidv4()}/run`, {
      headers,
      body: { input: 'hello' },
    });
    expect(res.status).toBe(404);
  });

  // Note: testing the actual start-run path requires Docker (to fork a worker).
  // If Docker is running, startRun() succeeds and creates real side effects.
  // The full agent loop is covered in tests/integration/loop/ via agentLoop() directly.
});

describe('GET /api/agents/:id/runs', () => {
  it('lists runs for an agent', async () => {
    const res = await request(url, 'GET', `/api/agents/${agentId}/runs`, { headers });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(2);
    // Runs are sorted by created_at DESC (latest first)
    expect(res.body[0].run_summary).toBe('Second run done');
  });

  it('run objects include expected fields', async () => {
    const res = await request(url, 'GET', `/api/agents/${agentId}/runs`, { headers });
    const run = res.body[0];
    expect(run.id).toBeDefined();
    expect(run.status).toBe('completed');
    expect(run.agent_id).toBe(agentId);
    expect(run.created_at).toBeDefined();
  });

  it('returns empty array for agent with no runs', async () => {
    const create = await request(url, 'POST', '/api/agents', {
      headers,
      body: { name: 'no-runs-agent', system_prompt: 'test', tools: [] },
    });
    const res = await request(url, 'GET', `/api/agents/${create.body.id}/runs`, { headers });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('GET /api/agents/:id/runs/:runId/messages', () => {
  it('returns messages for a run', async () => {
    const runs = await request(url, 'GET', `/api/agents/${agentId}/runs`, { headers });
    // Get the first (most recent) run with messages
    const runWithMessages = runs.body.find((r: any) => r.run_summary === 'First run done');

    const res = await request(url, 'GET', `/api/agents/${agentId}/runs/${runWithMessages.id}/messages`, { headers });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(2);
    expect(res.body[0].role).toBe('user');
    expect(res.body[1].role).toBe('assistant');
  });

  it('supports after= pagination', async () => {
    const runs = await request(url, 'GET', `/api/agents/${agentId}/runs`, { headers });
    const runWithMessages = runs.body.find((r: any) => r.run_summary === 'First run done');

    // Get all messages first
    const all = await request(url, 'GET', `/api/agents/${agentId}/runs/${runWithMessages.id}/messages`, { headers });
    const firstSeq = all.body[0].seq;

    // Get messages after the first one
    const res = await request(url, 'GET', `/api/agents/${agentId}/runs/${runWithMessages.id}/messages?after=${firstSeq}`, { headers });
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].role).toBe('assistant');
  });
});

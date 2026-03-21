/**
 * Tests for SSE stream connection and initial events.
 * Live events from actual runs are tested in tests/integration/loop/.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { v4 as uuidv4 } from 'uuid';
import { Daemon } from '../../../src/daemon/daemon.js';
import Run from '../../../src/db/models/Run.js';
import { createTestUser, createTestServer, request, silentLogger } from '../../helpers/integration.js';

let url: string;
let close: () => Promise<void>;
let headers: Record<string, string>;
let sessionToken: string;
let agentId: string;

beforeAll(async () => {
  const daemon = new Daemon(silentLogger);
  await daemon.init();
  const srv = await createTestServer(daemon);
  url = srv.url;
  close = srv.close;
  const user = await createTestUser();
  headers = user.headers;
  sessionToken = user.sessionToken;

  // Create an agent with a completed run
  const create = await request(url, 'POST', '/api/agents', {
    headers,
    body: { name: 'sse-test-agent', system_prompt: 'test', tools: [] },
  });
  agentId = create.body.id;

  // Seed a run
  const run = await Run.create({
    id: uuidv4(), agent_id: agentId, cwd: '/workspace', status: 'completed',
  });
  await run.persistMessage('user', 'hello');
  await run.persistMessage('assistant', [{ type: 'text', text: 'world' }], {
    stopReason: 'end_turn', inputTokens: 10, outputTokens: 5,
  });
});

afterAll(async () => {
  await close();
});

/** Connect to SSE stream and collect events until condition is met or timeout. */
function connectSSE(
  streamUrl: string,
  opts: { maxEvents?: number; timeoutMs?: number } = {},
): Promise<Array<{ event: string; data: any }>> {
  const maxEvents = opts.maxEvents ?? 10;
  const timeoutMs = opts.timeoutMs ?? 5000;

  return new Promise((resolve, reject) => {
    const events: Array<{ event: string; data: any }> = [];
    const parsedUrl = new URL(streamUrl);

    const req = http.get({
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname,
      headers: { Cookie: `taurus_session=${sessionToken}` },
    }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`SSE returned ${res.statusCode}`));
        return;
      }

      let buffer = '';
      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        // Parse SSE events
        const parts = buffer.split('\n\n');
        buffer = parts.pop()!; // Keep incomplete event in buffer

        for (const part of parts) {
          if (!part.trim()) continue;
          const lines = part.split('\n');
          let event = 'message';
          let data = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) event = line.slice(7);
            if (line.startsWith('data: ')) data += line.slice(6);
          }
          if (data) {
            try {
              events.push({ event, data: JSON.parse(data) });
            } catch {
              events.push({ event, data });
            }
          }
          if (events.length >= maxEvents) {
            req.destroy();
            resolve(events);
            return;
          }
        }
      });

      res.on('end', () => resolve(events));
    });

    req.on('error', (err) => {
      if ((err as any).code !== 'ECONNRESET') reject(err);
      else resolve(events);
    });

    setTimeout(() => {
      req.destroy();
      resolve(events);
    }, timeoutMs);
  });
}

describe('GET /api/agents/:id/stream', () => {
  it('sends init event with agent data', async () => {
    const events = await connectSSE(`${url}/api/agents/${agentId}/stream`, {
      maxEvents: 3, timeoutMs: 3000,
    });

    // Server sends data-only SSE (no event: field), so type is inside data.type
    const init = events.find((e) => e.data?.type === 'init');
    expect(init).toBeDefined();
    expect(init!.data.agent.id).toBe(agentId);
    expect(init!.data.agent.name).toBe('sse-test-agent');
  });

  it('sends history and messages events', async () => {
    const events = await connectSSE(`${url}/api/agents/${agentId}/stream`, {
      maxEvents: 5, timeoutMs: 3000,
    });

    const dataTypes = events.map((e) => e.data?.type).filter(Boolean);
    expect(dataTypes).toContain('init');
    const hasData = dataTypes.includes('history') || dataTypes.includes('messages');
    expect(hasData).toBe(true);
  });

  it('rejects unauthenticated connections', async () => {
    const parsedUrl = new URL(`${url}/api/agents/${agentId}/stream`);
    const result = await new Promise<number>((resolve) => {
      const req = http.get({
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname,
        // No auth cookie
      }, (res) => {
        resolve(res.statusCode!);
        req.destroy();
      });
      req.on('error', () => resolve(0));
    });
    expect(result).toBe(401);
  });
});

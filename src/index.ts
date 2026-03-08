/**
 * Taurus Daemon — the main entry point.
 *
 * Spawns Daemon, HTTP API server, and handles graceful shutdown.
 * ./taurus runs this. Terminal shows structured logs. Web UI on :7777.
 */

import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Database } from './db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import models so Sequelize registers them
import './db/models/Run.js';
import './db/models/Message.js';
import './db/models/ToolCall.js';
import './db/models/Folder.js';
import './db/models/Agent.js';
import './db/models/AgentLog.js';

import { Daemon } from './daemon/daemon.js';

const PORT = parseInt(process.env.TAURUS_PORT ?? '7777', 10);

// ── JSON helpers ──

function json(res: http.ServerResponse, data: any, status = 200): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

function error(res: http.ServerResponse, message: string, status = 400): void {
  json(res, { error: message }, status);
}

async function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// ── Route matching ──

type Route = {
  method: string;
  pattern: RegExp;
  handler: (req: http.IncomingMessage, res: http.ServerResponse, params: Record<string, string>) => Promise<void>;
};

function route(method: string, path: string, handler: Route['handler']): Route {
  const pattern = new RegExp(
    '^' + path.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'
  );
  return { method, pattern, handler };
}

// ── Main ──

async function main() {
  // 1. Boot database
  await Database.sync();

  // 2. Create and init daemon
  const daemon = new Daemon();
  await daemon.init();

  // 3. Define routes
  const routes: Route[] = [
    // ── Folders ──
    route('GET', '/api/folders', async (_req, res) => {
      const folders = await daemon.listFolders();
      json(res, folders);
    }),

    route('POST', '/api/folders', async (req, res) => {
      const body = await parseBody(req);
      if (!body.name) return error(res, 'name is required');
      const folder = await daemon.createFolder(body.name, body.parentId);
      json(res, folder, 201);
    }),

    route('DELETE', '/api/folders/:id', async (_req, res, params) => {
      try {
        await daemon.deleteFolder(params.id);
        json(res, { ok: true });
      } catch (err: any) {
        error(res, err.message);
      }
    }),

    // ── Agents ──
    route('GET', '/api/agents', async (req, res) => {
      const url = new URL(req.url!, `http://localhost`);
      const folderId = url.searchParams.get('folderId') ?? undefined;
      const agents = await daemon.listAgents(folderId);
      json(res, agents);
    }),

    route('POST', '/api/agents', async (req, res) => {
      const body = await parseBody(req);
      if (!body.name || !body.type || !body.systemPrompt) {
        return error(res, 'name, type, and systemPrompt are required');
      }
      try {
        const agent = await daemon.createAgent({
          name: body.name,
          type: body.type,
          systemPrompt: body.systemPrompt,
          tools: body.tools ?? ['Read', 'Glob', 'Grep'],
          cwd: body.cwd ?? process.cwd(),
          folderId: body.folderId,
          model: body.model,
          schedule: body.schedule,
          maxTurns: body.maxTurns,
          timeoutMs: body.timeoutMs,
          metadata: body.metadata,
          dockerImage: body.dockerImage,
        });
        json(res, agent, 201);
      } catch (err: any) {
        error(res, err.message);
      }
    }),

    route('GET', '/api/agents/:id', async (_req, res, params) => {
      const agent = await daemon.getAgent(params.id);
      if (!agent) return error(res, 'Agent not found', 404);
      json(res, agent);
    }),

    route('PUT', '/api/agents/:id', async (req, res, params) => {
      const body = await parseBody(req);
      try {
        const agent = await daemon.updateAgent(params.id, body);
        json(res, agent);
      } catch (err: any) {
        error(res, err.message);
      }
    }),

    route('DELETE', '/api/agents/:id', async (_req, res, params) => {
      try {
        await daemon.deleteAgent(params.id);
        json(res, { ok: true });
      } catch (err: any) {
        error(res, err.message);
      }
    }),

    // ── Run Management ──
    route('POST', '/api/agents/:id/run', async (req, res, params) => {
      const body = await parseBody(req);
      try {
        const runId = await daemon.startRun(
          params.id,
          body.trigger ?? 'manual',
          body.input,
          body.continueRun ?? false,
        );
        json(res, { runId }, 201);
      } catch (err: any) {
        error(res, err.message);
      }
    }),

    route('DELETE', '/api/agents/:id/run', async (_req, res, params) => {
      try {
        await daemon.stopRun(params.id, 'API stop request');
        json(res, { ok: true });
      } catch (err: any) {
        error(res, err.message);
      }
    }),

    route('POST', '/api/agents/:id/resume', async (req, res, params) => {
      const body = await parseBody(req);
      try {
        await daemon.resumeAgent(params.id, body.message);
        json(res, { ok: true });
      } catch (err: any) {
        error(res, err.message);
      }
    }),

    route('POST', '/api/agents/:id/inject', async (req, res, params) => {
      const body = await parseBody(req);
      if (!body.message) return error(res, 'message is required');
      try {
        await daemon.injectMessage(params.id, body.message);
        json(res, { ok: true });
      } catch (err: any) {
        error(res, err.message);
      }
    }),

    // ── Logs & Runs ──
    route('GET', '/api/agents/:id/stream', async (_req, res, params) => {
      // SSE endpoint — keeps connection alive, sends history on connect
      await daemon.addSSEClient(params.id, res);
    }),

    route('GET', '/api/agents/:id/logs', async (_req, res, params) => {
      const logs = await daemon.getAgentLogs(params.id, 100);
      json(res, logs);
    }),

    route('GET', '/api/agents/:id/runs', async (_req, res, params) => {
      const runs = await daemon.getAgentRuns(params.id);
      json(res, runs);
    }),

    // ── Health ──
    route('GET', '/api/health', async (_req, res) => {
      json(res, { status: 'ok', uptime: process.uptime() });
    }),
  ];

  // 4. Create HTTP server
  const server = http.createServer(async (req, res) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      return res.end();
    }

    const url = new URL(req.url!, `http://localhost:${PORT}`);

    for (const r of routes) {
      if (req.method !== r.method) continue;
      const match = url.pathname.match(r.pattern);
      if (match) {
        try {
          await r.handler(req, res, match.groups ?? {});
        } catch (err: any) {
          error(res, `Internal error: ${err.message}`, 500);
        }
        return;
      }
    }

    // Serve web UI for root and unknown paths
    if (req.method === 'GET' && (url.pathname === '/' || !url.pathname.startsWith('/api/'))) {
      const htmlPath = path.join(__dirname, 'web', 'index.html');
      try {
        const html = fs.readFileSync(htmlPath, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } catch {
        error(res, 'Not found', 404);
      }
      return;
    }

    error(res, 'Not found', 404);
  });

  const agentCount = (await daemon.listAgents()).length;
  server.listen(PORT, () => {
    console.log(`\n  Taurus Daemon v0.1.0`);
    console.log(`  HTTP API: http://localhost:${PORT}`);
    console.log(`  Agents: ${agentCount}`);
    console.log(`  Ctrl+C to stop\n`);
  });

  // 5. Graceful shutdown handling
  let shutdownCount = 0;
  let shutdownInProgress = false;

  async function handleShutdown() {
    shutdownCount++;

    if (shutdownCount === 1 && !shutdownInProgress) {
      shutdownInProgress = true;
      console.log('\nGraceful shutdown... (press Ctrl+C again to force)');
      try {
        await daemon.shutdown();
        server.close();
        await Database.close();
        process.exit(0);
      } catch (err) {
        console.error('Shutdown error:', err);
        process.exit(1);
      }
    } else if (shutdownCount === 2) {
      console.log('\nForce shutdown — killing all children...');
      daemon.forceShutdown();
      setTimeout(() => process.exit(1), 2000);
    } else {
      process.exit(1);
    }
  }

  process.on('SIGINT', handleShutdown);
  process.on('SIGTERM', handleShutdown);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

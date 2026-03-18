import type http from 'node:http';
import type { Daemon } from '../../daemon/daemon.js';
import { json, error, parseBody, route, type Route } from '../helpers.js';
import { assertAccessToAgent, assertRunBelongsToAgent, assertMessageBelongsToRun } from '../auth/index.js';
import { NotFoundError } from '../../core/errors.js';
import { DEFAULT_TOOLS } from '../../core/defaults.js';
import { ALLOW_ARBITRARY_BIND_MOUNTS } from '../../core/config.js';

/**
 * Shared handler for POST /api/ask and POST /api/agents/:id/ask.
 * Sends a message, blocks until the run completes, returns the result.
 */
async function handleAsk(
  daemon: Daemon,
  agentId: string,
  body: any,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const message = body.message;
  if (!message) return error(res, 'message is required');

  const forceNew = body.new === true;
  const full = body.full === true;
  const timeoutMs = body.timeout ?? 300_000;

  // Disable socket timeout for long-running requests
  req.socket.setTimeout(0);

  const agent = await daemon.getAgent(agentId);
  if (!agent) return error(res, 'Agent not found', 404);

  try {
    let runId: string;

    if (agent.status === 'paused') {
      // Resume via continueRun (which does IPC resume if worker is alive)
      runId = daemon.getCurrentRunId(agentId) ?? '';
      const completionPromise = daemon.awaitRunCompletion(runId, timeoutMs);
      await daemon.continueRun(agentId, runId, message);
      const result = await completionPromise;
      return sendAskResult(res, runId, result, full ? daemon : undefined);
    }

    if (agent.status === 'running') {
      return error(res, `Agent "${agent.name}" is already running`);
    }

    if (forceNew) {
      runId = await daemon.startRun(agentId, 'manual', message);
    } else {
      // Continue last run, or start new if none exists
      const runs = await daemon.getAgentRuns(agentId, 1);
      if (runs.length > 0) {
        runId = runs[0].id;
        const completionPromise = daemon.awaitRunCompletion(runId, timeoutMs);
        await daemon.continueRun(agentId, runId, message);
        const result = await completionPromise;
        return sendAskResult(res, runId, result, full ? daemon : undefined);
      } else {
        runId = await daemon.startRun(agentId, 'manual', message);
      }
    }

    // For startRun: register waiter after getting runId (safe — LLM call takes time)
    const result = await daemon.awaitRunCompletion(runId, timeoutMs);
    return sendAskResult(res, runId, result, full ? daemon : undefined);
  } catch (err: any) {
    error(res, err.message);
  }
}

async function sendAskResult(
  res: http.ServerResponse,
  runId: string,
  result: { summary: string; error?: string; tokens?: { input: number; output: number; cost: number } },
  daemon?: Daemon,
): Promise<void> {
  if (result.error) {
    const payload: any = { error: result.error, run_id: runId };
    if (result.summary) payload.response = result.summary;
    return json(res, payload, 500);
  }
  if (daemon) {
    const messages = await daemon.getRunMessages(runId);
    json(res, { response: result.summary, run_id: runId, tokens: result.tokens, messages });
  } else {
    json(res, { response: result.summary, run_id: runId, tokens: result.tokens });
  }
}

export function agentRoutes(daemon: Daemon): Route[] {
  return [
    // ── CRUD ──
    route('GET', '/api/agents', async (ctx) => {
      const url = new URL(ctx.req.url!, `http://localhost`);
      const folder_id = url.searchParams.get('folder_id') ?? undefined;
      const agents = await daemon.listAgents(ctx.user.id, folder_id);
      json(ctx.res, agents);
    }),

    route('POST', '/api/agents', async (ctx) => {
      const body = await parseBody(ctx.req);
      if (!body.name || !body.system_prompt) {
        return error(ctx.res, 'name and system_prompt are required');
      }
      if (!ALLOW_ARBITRARY_BIND_MOUNTS && body.mounts?.length > 0) {
        return error(ctx.res, 'Arbitrary bind mounts are disabled in this deployment', 403);
      }
      try {
        const agent = await daemon.createAgent({
          name: body.name,
          system_prompt: body.system_prompt,
          tools: body.tools ?? DEFAULT_TOOLS,
          cwd: body.cwd ?? '/workspace',
          user_id: ctx.user.id,
          parent_agent_id: body.parent_agent_id,
          folder_id: body.folder_id,
          model: body.model,
          schedule: body.schedule,
          schedule_overlap: body.schedule_overlap,
          max_turns: body.max_turns,
          timeout_ms: body.timeout_ms,
          metadata: body.metadata,
          docker_image: body.docker_image,
          mounts: body.mounts,
        });
        json(ctx.res, agent, 201);
      } catch (err: any) {
        error(ctx.res, err.message);
      }
    }),

    route('GET', '/api/agents/:id', async (ctx) => {
      await assertAccessToAgent(ctx.params.id, ctx.user);
      const agent = await daemon.getAgent(ctx.params.id);
      if (!agent) return error(ctx.res, 'Agent not found', 404);
      const children = daemon.getChildren(ctx.params.id).map(c => ({
        id: c.id, name: c.name, status: c.status,
      }));
      json(ctx.res, { ...agent, children });
    }),

    route('PUT', '/api/agents/:id', async (ctx) => {
      await assertAccessToAgent(ctx.params.id, ctx.user);
      const body = await parseBody(ctx.req);
      if (!ALLOW_ARBITRARY_BIND_MOUNTS && body.mounts?.length > 0) {
        return error(ctx.res, 'Arbitrary bind mounts are disabled in this deployment', 403);
      }
      try {
        const agent = await daemon.updateAgent(ctx.params.id, body);
        json(ctx.res, agent);
      } catch (err: any) {
        error(ctx.res, err.message);
      }
    }),

    route('DELETE', '/api/agents/:id', async (ctx) => {
      await assertAccessToAgent(ctx.params.id, ctx.user);
      try {
        await daemon.deleteAgent(ctx.params.id);
        json(ctx.res, { ok: true });
      } catch (err: any) {
        error(ctx.res, err.message);
      }
    }),

    // ── Run Management ──
    route('POST', '/api/agents/:id/run', async (ctx) => {
      await assertAccessToAgent(ctx.params.id, ctx.user);
      const body = await parseBody(ctx.req);
      try {
        if (body.run_id) {
          await daemon.continueRun(ctx.params.id, body.run_id, body.input, body.images);
          json(ctx.res, { runId: body.run_id });
        } else {
          const runId = await daemon.startRun(
            ctx.params.id,
            body.trigger ?? 'manual',
            body.input,
            body.images,
          );
          json(ctx.res, { runId }, 201);
        }
      } catch (err: any) {
        error(ctx.res, err.message);
      }
    }),

    route('DELETE', '/api/agents/:id/run', async (ctx) => {
      await assertAccessToAgent(ctx.params.id, ctx.user);
      try {
        await daemon.stopAllRuns(ctx.params.id, 'API stop request');
        json(ctx.res, { ok: true });
      } catch (err: any) {
        error(ctx.res, err.message);
      }
    }),

    route('DELETE', '/api/agents/:id/runs/:runId', async (ctx) => {
      await assertAccessToAgent(ctx.params.id, ctx.user);
      await assertRunBelongsToAgent(ctx.params.runId, ctx.params.id);
      try {
        await daemon.stopRun(ctx.params.id, ctx.params.runId, 'API stop request');
        json(ctx.res, { ok: true });
      } catch (err: any) {
        error(ctx.res, err.message);
      }
    }),

    route('POST', '/api/agents/:id/message', async (ctx) => {
      await assertAccessToAgent(ctx.params.id, ctx.user);
      const body = await parseBody(ctx.req);
      if (!body.message) return error(ctx.res, 'message is required');
      try {
        const runId = await daemon.sendMessage(ctx.params.id, body.message, {
          images: body.images,
          run_id: body.run_id,
        });
        json(ctx.res, { runId });
      } catch (err: any) {
        error(ctx.res, err.message);
      }
    }),

    // ── SSE, Logs, Runs ──
    route('GET', '/api/agents/:id/stream', async (ctx) => {
      await assertAccessToAgent(ctx.params.id, ctx.user);
      await daemon.addSSEClient(ctx.params.id, ctx.res);
    }),

    route('GET', '/api/agents/:id/logs', async (ctx) => {
      await assertAccessToAgent(ctx.params.id, ctx.user);
      const logs = await daemon.getAgentLogs(ctx.params.id, 100);
      json(ctx.res, logs);
    }),

    route('GET', '/api/agents/:id/runs', async (ctx) => {
      await assertAccessToAgent(ctx.params.id, ctx.user);
      const runs = await daemon.getAgentRuns(ctx.params.id);
      json(ctx.res, runs);
    }),

    route('GET', '/api/agents/:id/runs/:runId/messages', async (ctx) => {
      await assertAccessToAgent(ctx.params.id, ctx.user);
      await assertRunBelongsToAgent(ctx.params.runId, ctx.params.id);
      const url = new URL(ctx.req.url!, `http://localhost`);
      const afterStr = url.searchParams.get('after');
      const afterSeq = afterStr ? parseInt(afterStr, 10) : undefined;
      const messages = await daemon.getRunMessages(ctx.params.runId, afterSeq);
      json(ctx.res, messages);
    }),

    route('DELETE', '/api/agents/:id/runs/:runId/messages/:messageId', async (ctx) => {
      await assertAccessToAgent(ctx.params.id, ctx.user);
      await assertRunBelongsToAgent(ctx.params.runId, ctx.params.id);
      await assertMessageBelongsToRun(ctx.params.messageId, ctx.params.runId);
      const ok = await daemon.deleteMessage(ctx.params.messageId);
      if (!ok) return error(ctx.res, 'Message not found', 404);
      json(ctx.res, { ok: true });
    }),

    // ── Blocking ask ──

    // By name: POST /api/ask { agent: "my-agent", message: "..." }
    route('POST', '/api/ask', async (ctx) => {
      const body = await parseBody(ctx.req);
      if (!body.agent) return error(ctx.res, 'agent (name) is required');
      const agent = daemon.findAgentByName(ctx.user.id, body.agent);
      if (!agent) {
        throw new NotFoundError(`Agent not found: "${body.agent}"`)
;
      }
      await handleAsk(daemon, agent.id, body, ctx.req, ctx.res);
    }),

    // By ID: POST /api/agents/:id/ask { message: "..." }
    route('POST', '/api/agents/:id/ask', async (ctx) => {
      await assertAccessToAgent(ctx.params.id, ctx.user);
      const body = await parseBody(ctx.req);
      await handleAsk(daemon, ctx.params.id, body, ctx.req, ctx.res);
    }),
  ];
}

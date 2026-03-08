/**
 * Daemon — runs in the parent process.
 *
 * Owns the child process map. Spawns/stops workers via fork().
 * Routes IPC messages. Persists all data to DB. Broadcasts SSE.
 */

import { fork, execSync, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v4 as uuidv4 } from 'uuid';
import type { ServerResponse } from 'node:http';
import type {
  AgentConfig, AgentStatus, TriggerType, ChildMessage, ParentMessage, LogLevel,
} from './types.js';
import { ROOT_FOLDER_ID } from './types.js';
import Agent from '../db/models/Agent.js';
import AgentLog from '../db/models/AgentLog.js';
import Folder from '../db/models/Folder.js';
import Run from '../db/models/Run.js';
import Message from '../db/models/Message.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKER_PATH = path.join(__dirname, 'agent-worker.ts');

interface ManagedAgent {
  config: AgentConfig;
  process: ChildProcess | null;
  currentRunId: string | null;
}

export class Daemon {
  private agents = new Map<string, ManagedAgent>();
  /** Per-agent SSE clients. */
  private sseClients = new Map<string, Set<ServerResponse>>();
  private logger: (level: LogLevel, msg: string) => void;

  constructor(logger?: (level: LogLevel, msg: string) => void) {
    this.logger = logger ?? ((level, msg) => {
      const ts = new Date().toISOString().slice(11, 19);
      const prefix = { debug: 'DBG', info: 'INF', warn: 'WRN', error: 'ERR' }[level];
      console.log(`[${ts}] ${prefix} ${msg}`);
    });
  }

  // ── Lifecycle ──

  async init(): Promise<void> {
    // Seed root folder
    await Folder.seedRoot();

    // Load all agents from DB
    const agents = await Agent.findAll();
    for (const agent of agents) {
      const config = agent.toConfig();
      // Reset any that were "running" when daemon died
      if (config.status === 'running' || config.status === 'paused') {
        await agent.update({ status: 'idle' });
        config.status = 'idle';
      }
      this.agents.set(config.id, { config, process: null, currentRunId: null });
    }

    this.logger('info', `Daemon initialized. ${this.agents.size} agent(s) loaded.`);

    // TODO: set up cron jobs for scheduled agents
  }

  async shutdown(): Promise<void> {
    this.logger('info', 'Graceful shutdown starting...');

    const stopPromises: Promise<void>[] = [];
    for (const [id, managed] of this.agents) {
      if (managed.process) {
        stopPromises.push(this.stopRun(id, 'daemon shutdown'));
      }
    }

    await Promise.allSettled(stopPromises);

    // Update all agents to idle
    for (const [, managed] of this.agents) {
      if (managed.config.status !== 'disabled') {
        await Agent.update({ status: 'idle' }, { where: { id: managed.config.id } });
      }
    }

    // Stop all Docker containers
    for (const [, managed] of this.agents) {
      await this.stopContainer(managed.config.containerId);
    }

    // Close all SSE clients
    for (const clients of this.sseClients.values()) {
      for (const res of clients) {
        res.end();
      }
    }
    this.sseClients.clear();

    this.logger('info', 'Graceful shutdown complete.');
  }

  forceShutdown(): void {
    this.logger('warn', 'Force shutdown — killing all children.');
    for (const [, managed] of this.agents) {
      if (managed.process && !managed.process.killed) {
        managed.process.kill('SIGKILL');
      }
    }
  }

  // ── Agent CRUD ──

  async createAgent(input: {
    name: string;
    type: 'observer' | 'actor';
    systemPrompt: string;
    tools: string[];
    cwd: string;
    folderId?: string;
    model?: string;
    schedule?: string;
    maxTurns?: number;
    timeoutMs?: number;
    metadata?: Record<string, unknown>;
    dockerImage?: string;
  }): Promise<AgentConfig> {
    const agent = await Agent.create({
      name: input.name,
      type: input.type,
      system_prompt: input.systemPrompt,
      tools: JSON.stringify(input.tools),
      cwd: input.cwd,
      folder_id: input.folderId ?? ROOT_FOLDER_ID,
      model: input.model ?? 'claude-sonnet-4-20250514',
      schedule: input.schedule ?? null,
      max_turns: input.maxTurns ?? 20,
      timeout_ms: input.timeoutMs ?? 300_000,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      docker_image: input.dockerImage ?? 'ubuntu:22.04',
    });

    const config = agent.toConfig();
    this.agents.set(config.id, { config, process: null, currentRunId: null });
    this.logger('info', `Agent created: "${config.name}" (${config.id})`);

    return config;
  }

  async updateAgent(id: string, updates: Partial<{
    name: string;
    type: 'observer' | 'actor';
    systemPrompt: string;
    tools: string[];
    cwd: string;
    folderId: string;
    model: string;
    schedule: string | null;
    maxTurns: number;
    timeoutMs: number;
    metadata: Record<string, unknown>;
    status: AgentStatus;
  }>): Promise<AgentConfig> {
    const agent = await Agent.findByPk(id);
    if (!agent) throw new Error(`Agent not found: ${id}`);

    const dbUpdates: any = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.type !== undefined) dbUpdates.type = updates.type;
    if (updates.systemPrompt !== undefined) dbUpdates.system_prompt = updates.systemPrompt;
    if (updates.tools !== undefined) dbUpdates.tools = JSON.stringify(updates.tools);
    if (updates.cwd !== undefined) dbUpdates.cwd = updates.cwd;
    if (updates.folderId !== undefined) dbUpdates.folder_id = updates.folderId;
    if (updates.model !== undefined) dbUpdates.model = updates.model;
    if (updates.schedule !== undefined) dbUpdates.schedule = updates.schedule;
    if (updates.maxTurns !== undefined) dbUpdates.max_turns = updates.maxTurns;
    if (updates.timeoutMs !== undefined) dbUpdates.timeout_ms = updates.timeoutMs;
    if (updates.metadata !== undefined) dbUpdates.metadata = JSON.stringify(updates.metadata);
    if (updates.status !== undefined) dbUpdates.status = updates.status;

    await agent.update(dbUpdates);
    const config = agent.toConfig();

    const managed = this.agents.get(id);
    if (managed) managed.config = config;

    return config;
  }

  async deleteAgent(id: string): Promise<void> {
    const managed = this.agents.get(id);
    if (managed?.process) {
      await this.stopRun(id, 'agent deleted');
    }

    // Remove Docker container and volume
    if (managed) {
      await this.removeContainer(managed.config);
    }

    await AgentLog.destroy({ where: { thread_id: id } });
    await Agent.destroy({ where: { id } });
    this.agents.delete(id);

    this.logger('info', `Agent deleted: ${id}`);
  }

  async getAgent(id: string): Promise<AgentConfig | null> {
    return this.agents.get(id)?.config ?? null;
  }

  async listAgents(folderId?: string): Promise<AgentConfig[]> {
    const all = [...this.agents.values()].map(m => m.config);
    if (folderId) return all.filter(c => c.folderId === folderId);
    return all;
  }

  // ── Folder CRUD ──

  async createFolder(name: string, parentId?: string): Promise<{ id: string; name: string; parentId: string | null }> {
    const folder = await Folder.create({
      id: uuidv4(),
      name,
      parent_id: parentId ?? ROOT_FOLDER_ID,
    });
    return folder.toApi();
  }

  async listFolders(): Promise<any[]> {
    const folders = await Folder.getTree();
    return folders.map(f => f.toApi());
  }

  async deleteFolder(id: string): Promise<void> {
    if (id === ROOT_FOLDER_ID) throw new Error('Cannot delete root folder');
    const folder = await Folder.findByPk(id);
    if (!folder) throw new Error(`Folder not found: ${id}`);

    // Move children agents to parent folder
    const parentId = folder.parent_id ?? ROOT_FOLDER_ID;
    await Agent.update({ folder_id: parentId }, { where: { folder_id: id } });
    await Folder.update({ parent_id: parentId }, { where: { parent_id: id } });
    await folder.destroy();
  }

  // ── Docker Container Lifecycle ──

  private dockerExec(args: string): string {
    return execSync(`docker ${args}`, { encoding: 'utf-8', timeout: 30_000 }).trim();
  }

  private isContainerRunning(containerId: string): boolean {
    try {
      const state = this.dockerExec(`inspect --format '{{.State.Running}}' ${containerId}`);
      return state === 'true';
    } catch {
      return false;
    }
  }

  private containerExists(containerId: string): boolean {
    try {
      this.dockerExec(`inspect ${containerId}`);
      return true;
    } catch {
      return false;
    }
  }

  async ensureContainer(config: AgentConfig): Promise<void> {
    const { containerId, dockerImage } = config;

    if (this.isContainerRunning(containerId)) return;

    if (this.containerExists(containerId)) {
      // Container exists but stopped — start it
      this.dockerExec(`start ${containerId}`);
      this.logger('info', `Container started: ${containerId}`);
      return;
    }

    // Create and start container — fully isolated, no host mounts
    const volumeName = `taurus-vol-${config.id}`;
    try {
      this.dockerExec(`volume create ${volumeName}`);
    } catch {
      // Volume may already exist
    }

    // Create container: long-running sleep process, workspace on persistent volume
    this.dockerExec(
      `create --name ${containerId} ` +
      `-v ${volumeName}:/workspace ` +
      `-w /workspace ` +
      `${dockerImage} sleep infinity`
    );

    this.dockerExec(`start ${containerId}`);

    // Copy scaffold into /workspace so the agent has files to work with
    const scaffoldDir = path.join(__dirname, '..', '..', 'scaffold');
    try {
      this.dockerExec(`cp ${scaffoldDir}/. ${containerId}:/workspace/`);
      this.logger('info', `Scaffold copied into ${containerId}:/workspace/`);
    } catch {
      this.logger('warn', `No scaffold directory found or copy failed — container starts empty`);
    }

    this.logger('info', `Container created and started: ${containerId} (image: ${dockerImage})`);
  }

  async stopContainer(containerId: string): Promise<void> {
    if (this.isContainerRunning(containerId)) {
      try {
        this.dockerExec(`stop -t 5 ${containerId}`);
        this.logger('info', `Container stopped: ${containerId}`);
      } catch (err: any) {
        this.logger('warn', `Failed to stop container ${containerId}: ${err.message}`);
      }
    }
  }

  async removeContainer(config: AgentConfig): Promise<void> {
    const { containerId } = config;
    try {
      this.dockerExec(`rm -f ${containerId}`);
    } catch { /* ignore */ }
    try {
      this.dockerExec(`volume rm taurus-vol-${config.id}`);
    } catch { /* ignore */ }
    this.logger('info', `Container removed: ${containerId}`);
  }

  // ── Run Management ──

  async startRun(agentId: string, trigger: TriggerType = 'manual', input?: string, continueRun?: boolean): Promise<string> {
    const managed = this.agents.get(agentId);
    if (!managed) throw new Error(`Agent not found: ${agentId}`);
    if (managed.process) throw new Error(`Agent "${managed.config.name}" is already running`);

    // Ensure Docker container is running
    await this.ensureContainer(managed.config);

    // Load history from previous run if continuing
    let history: Array<{ role: string; content: any }> | undefined;
    let runId: string;

    if (continueRun) {
      const prevRun = await Run.findOne({
        where: { thread_id: agentId },
        order: [['created_at', 'DESC']],
      });
      if (prevRun) {
        const messages = await Message.findAll({
          where: { session_id: prevRun.id },
          order: [['created_at', 'ASC']],
        });
        if (messages.length > 0) {
          history = messages.map(m => {
            let content: any = m.content;
            try { content = JSON.parse(m.content); } catch {}
            return { role: m.role, content };
          });
        }
      }
    }

    // Create run record
    const run = await Run.create({
      cwd: managed.config.cwd,
      model: managed.config.model,
      thread_id: agentId,
      trigger,
    });
    runId = run.id;

    // Fork the worker
    const child = fork(WORKER_PATH, [], {
      execArgv: ['--import', 'tsx'],
      serialization: 'advanced',
      env: { ...process.env },
    });

    managed.process = child;
    managed.currentRunId = runId;

    // Set up IPC handler
    child.on('message', (msg: ChildMessage) => {
      this.handleChildMessage(agentId, runId, msg);
    });

    child.on('exit', (code) => {
      this.handleChildExit(agentId, code);
    });

    child.on('error', (err) => {
      this.logger('error', `Agent "${managed.config.name}" process error: ${err.message}`);
    });

    // Wait for 'ready' then send 'start'
    const startMsg: ParentMessage = {
      type: 'start',
      config: managed.config,
      sessionId: runId,
      trigger,
      input,
      history,
    };

    // Small delay to ensure the child is ready
    await new Promise<void>((resolve) => {
      const onMessage = (msg: ChildMessage) => {
        if (msg.type === 'ready') {
          child.off('message', onMessage);
          resolve();
        }
      };
      child.on('message', onMessage);
      // Timeout after 10s
      setTimeout(resolve, 10_000);
    });

    child.send(startMsg);

    // Update status
    await this.updateAgentStatus(agentId, 'running');
    this.logger('info', `Agent "${managed.config.name}" run started (run: ${runId})`);

    return runId;
  }

  async stopRun(agentId: string, reason: string = 'user requested'): Promise<void> {
    const managed = this.agents.get(agentId);
    if (!managed?.process) return;

    const stopMsg: ParentMessage = { type: 'stop', reason };
    managed.process.send(stopMsg);

    // Wait for graceful exit
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (managed.process && !managed.process.killed) {
          managed.process.kill('SIGKILL');
        }
        resolve();
      }, 10_000);

      managed.process!.on('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async resumeAgent(agentId: string, message?: string): Promise<void> {
    const managed = this.agents.get(agentId);
    if (!managed?.process) throw new Error('Agent is not running');
    if (managed.config.status !== 'paused') throw new Error('Agent is not paused');

    const msg: ParentMessage = { type: 'resume', message };
    managed.process.send(msg);
    await this.updateAgentStatus(agentId, 'running');
  }

  async injectMessage(agentId: string, message: string): Promise<void> {
    const managed = this.agents.get(agentId);
    if (!managed?.process) throw new Error('Agent is not running');

    // If paused, resume with the message instead
    if (managed.config.status === 'paused') {
      managed.process.send({ type: 'resume', message } as ParentMessage);
      await this.updateAgentStatus(agentId, 'running');
      return;
    }

    const msg: ParentMessage = { type: 'inject', message };
    managed.process.send(msg);
  }

  // ── IPC Handling ──

  private async handleChildMessage(agentId: string, runId: string, msg: ChildMessage): Promise<void> {
    const managed = this.agents.get(agentId);
    if (!managed) return;

    switch (msg.type) {
      case 'ready':
        // Already handled in startRun
        break;

      case 'log': {
        // Streaming text tokens: forward to SSE for live display, but don't persist
        if (msg.event === 'llm.text') {
          this.broadcastSSE(agentId, {
            type: 'llm_text',
            agentId,
            text: msg.message,
          });
          break;
        }

        // Persist to DB (skip debug level to reduce volume)
        if (msg.level !== 'debug') {
          await AgentLog.create({
            thread_id: agentId,
            session_id: runId,
            level: msg.level,
            event: msg.event,
            message: msg.message,
            data: msg.data ? JSON.stringify(msg.data) : null,
          });
        }

        // Log to terminal (skip debug level for cleanliness)
        if (msg.level !== 'debug') {
          this.logger(msg.level, `[${managed.config.name}] ${msg.message}`);
        }

        // Broadcast to SSE clients (skip debug)
        if (msg.level === 'debug') break;
        this.broadcastSSE(agentId, {
          type: 'log',
          agentId,
          runId,
          level: msg.level,
          event: msg.event,
          message: msg.message,
          data: msg.data,
          timestamp: new Date().toISOString(),
        });
        break;
      }

      case 'status':
        await this.updateAgentStatus(agentId, msg.status);
        break;

      case 'paused':
        await this.updateAgentStatus(agentId, 'paused');
        this.logger('info', `[${managed.config.name}] Paused: ${msg.reason}`);
        this.broadcastSSE(agentId, {
          type: 'agent_paused',
          agentId,
          reason: msg.reason,
          timestamp: new Date().toISOString(),
        });
        break;

      case 'message_persist': {
        const run = await Run.findByPk(msg.sessionId);
        if (run) {
          await run.addMessage(msg.role, msg.content, {
            stopReason: msg.stopReason,
            inputTokens: msg.inputTokens,
            outputTokens: msg.outputTokens,
          });
        }
        break;
      }

      case 'tool_persist':
        // TODO: persist tool call records
        break;

      case 'signal_emit':
        // TODO: route to other agents
        this.logger('info', `[${managed.config.name}] Signal emitted: ${msg.name}`);
        break;

      case 'run_complete': {
        const run = await Run.findByPk(msg.sessionId);
        if (run) {
          await run.update({
            run_summary: msg.summary,
            run_error: msg.error ?? null,
            total_input_tokens: run.totalInputTokens + msg.tokens.input,
            total_output_tokens: run.totalOutputTokens + msg.tokens.output,
          });
        }

        this.logger('info', `[${managed.config.name}] Run complete. Tokens: ${msg.tokens.input}in/${msg.tokens.output}out`);

        // Persist run summary as an AgentLog so it shows up on reload
        await AgentLog.create({
          thread_id: agentId,
          session_id: msg.sessionId,
          level: msg.error ? 'error' : 'info',
          event: 'run.complete',
          message: msg.summary || 'Run completed.',
          data: JSON.stringify({ tokens: msg.tokens, error: msg.error }),
        });

        this.broadcastSSE(agentId, {
          type: 'run_complete',
          agentId,
          runId: msg.sessionId,
          summary: msg.summary,
          error: msg.error,
          tokens: msg.tokens,
          timestamp: new Date().toISOString(),
        });
        break;
      }

      case 'error':
        this.logger('error', `[${managed.config.name}] Error: ${msg.error}`);
        await this.updateAgentStatus(agentId, 'error');

        if (managed.currentRunId) {
          const run = await Run.findByPk(managed.currentRunId);
          if (run) {
            await run.update({ run_error: msg.error });
          }
        }

        this.broadcastSSE(agentId, {
          type: 'agent_error',
          agentId,
          error: msg.error,
          timestamp: new Date().toISOString(),
        });
        break;
    }
  }

  private handleChildExit(agentId: string, code: number | null): void {
    const managed = this.agents.get(agentId);
    if (!managed) return;

    managed.process = null;
    managed.currentRunId = null;

    if (managed.config.status === 'running') {
      // Unexpected exit
      managed.config.status = code === 0 ? 'idle' : 'error';
      Agent.update(
        { status: managed.config.status },
        { where: { id: agentId } },
      ).catch(() => {}); // fire and forget
    }

    if (code !== 0 && code !== null) {
      this.logger('warn', `[${managed.config.name}] Process exited with code ${code}`);
    }
  }

  private async updateAgentStatus(agentId: string, status: AgentStatus): Promise<void> {
    const managed = this.agents.get(agentId);
    if (!managed) return;

    managed.config.status = status;
    await Agent.update({ status }, { where: { id: agentId } });

    this.broadcastSSE(agentId, {
      type: 'agent_status',
      agentId,
      status,
      timestamp: new Date().toISOString(),
    });
  }

  // ── SSE ──

  /**
   * Subscribe to SSE events for a specific agent.
   * Also sends recent log history on connect.
   */
  async addSSEClient(agentId: string, res: ServerResponse): Promise<void> {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    if (!this.sseClients.has(agentId)) {
      this.sseClients.set(agentId, new Set());
    }
    this.sseClients.get(agentId)!.add(res);

    res.on('close', () => {
      const clients = this.sseClients.get(agentId);
      if (clients) {
        clients.delete(res);
        if (clients.size === 0) this.sseClients.delete(agentId);
      }
    });

    // Send agent state
    const config = this.agents.get(agentId)?.config;
    if (config) {
      res.write(`data: ${JSON.stringify({ type: 'init', agent: config })}\n\n`);
    }

    // Send recent log history
    const logs = await this.getAgentLogs(agentId, 100);
    res.write(`data: ${JSON.stringify({ type: 'history', logs })}\n\n`);

    // Send messages from the most recent run so conversation survives reload
    const latestRun = await Run.findOne({
      where: { thread_id: agentId },
      order: [['created_at', 'DESC']],
    });
    if (latestRun) {
      const messages = await Message.findAll({
        where: { session_id: latestRun.id },
        order: [['created_at', 'ASC']],
      });
      if (messages.length > 0) {
        res.write(`data: ${JSON.stringify({
          type: 'messages',
          runId: latestRun.id,
          messages: messages.map(m => m.toApi()),
        })}\n\n`);
      }
    }
  }

  private broadcastSSE(agentId: string, data: any): void {
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    const clients = this.sseClients.get(agentId);
    if (clients) {
      for (const client of clients) {
        client.write(payload);
      }
    }
  }

  // ── Queries (for HTTP API) ──

  async getAgentRuns(agentId: string, limit: number = 20): Promise<any[]> {
    const runs = await Run.findAll({
      where: { thread_id: agentId },
      order: [['created_at', 'DESC']],
      limit,
    });
    return runs.map(r => r.toApi());
  }

  async getAgentLogs(agentId: string, limit: number = 100): Promise<any[]> {
    const logs = await AgentLog.findAll({
      where: { thread_id: agentId },
      order: [['created_at', 'DESC']],
      limit,
    });
    return logs.map(l => l.toApi());
  }
}

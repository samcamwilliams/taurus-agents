/**
 * Daemon — runs in the parent process.
 *
 * Owns the run→worker map. Spawns/stops workers via fork().
 * Routes IPC messages for coordination and SSE broadcasting.
 * Children handle their own DB reads/writes.
 *
 * Delegates Docker lifecycle to DockerService and SSE to SSEBroadcaster.
 */

import { fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AgentStatus, TriggerType, ChildMessage, ParentMessage, LogLevel,
} from './types.js';
import { DockerService } from './docker.js';
import { SSEBroadcaster } from './sse.js';
import { Scheduler } from './scheduler.js';
import { DEFAULT_MODEL, DEFAULT_DOCKER_IMAGE, DEFAULT_MAX_TURNS, DEFAULT_TIMEOUT_MS } from '../core/defaults.js';
import { Op } from 'sequelize';
import Agent from '../db/models/Agent.js';
import AgentLog from '../db/models/AgentLog.js';
import Run from '../db/models/Run.js';
import Message from '../db/models/Message.js';
import UserSecret from '../db/models/UserSecret.js';
import User from '../db/models/User.js';
import { parseSharedSecrets } from '../core/budget.js';
import {
  resolveAgentResourceLimits,
  agentResourceLimitsFromValues,
  resourceLimitsToDockerMemoryMb,
  type AgentResourceLimits,
} from '../core/config/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = path.join(__dirname, 'run-worker.ts');

interface ManagedRun {
  runId: string;
  process: ChildProcess;
  parentRunId: string | null;
  /** IPC routing — who to send the result back to when this run completes */
  callerRequestId: string | null;
  callerType: 'subrun' | 'delegate' | null;
  callerAgentId: string | null;   // delegate only — the agent that dispatched this
  callerRunId: string | null;     // delegate only — the run that dispatched this
  status: 'running' | 'paused';
}

interface ManagedAgent {
  agent: Agent;
  runs: Map<string, ManagedRun>;
  /** Number of active terminal WebSocket connections */
  terminals: number;
  /** Timer that pauses the container after idle timeout */
  idleTimer?: NodeJS.Timeout;
}

const CONTAINER_IDLE_MS = 5 * 60 * 1000; // 5 min before pausing idle containers

interface CompletionWaiter {
  resolve: (result: { summary: string; error?: string; tokens?: { input: number; output: number; cost: number } }) => void;
  timer: NodeJS.Timeout;
}

export class Daemon {
  private agents = new Map<string, ManagedAgent>();
  /** Keyed by runId — allows concurrent /api/ask calls to the same agent */
  private completionWaiters = new Map<string, CompletionWaiter[]>();
  /** Per-user notification SSE clients (userId → set of response streams) */
  private notificationClients = new Map<string, Set<import('node:http').ServerResponse>>();
  private logger: (level: LogLevel, msg: string) => void;
  readonly docker: DockerService;
  readonly sse: SSEBroadcaster;
  readonly scheduler: Scheduler;

  constructor(logger?: (level: LogLevel, msg: string) => void) {
    this.logger = logger ?? ((level, msg) => {
      const ts = new Date().toISOString().slice(11, 19);
      const prefix = { debug: 'DBG', info: 'INF', warn: 'WRN', error: 'ERR' }[level];
      console.log(`[${ts}] ${prefix} ${msg}`);
    });
    this.docker = new DockerService(this.logger);
    this.sse = new SSEBroadcaster();
    this.scheduler = new Scheduler(this, this.logger);
  }

  // ── Lifecycle ──

  async init(): Promise<void> {
    const agents = await Agent.findAll();
    for (const agent of agents) {
      if (agent.status === 'running') {
        await agent.update({ status: 'idle' });
      }
      this.agents.set(agent.id, { agent, runs: new Map(), terminals: 0 });
    }

    // Mark orphaned running runs as stopped — paused runs stay paused (no resources consumed)
    const orphanedRuns = await Run.findAll({ where: { status: 'running' } });
    if (orphanedRuns.length > 0) {
      await Run.update({ status: 'stopped' }, { where: { status: 'running' } });
      this.logger('warn', `Marked ${orphanedRuns.length} orphaned run(s) as stopped`);
    }

    // Register scheduled agents
    for (const agent of agents) {
      if (agent.schedule) {
        this.scheduler.register(agent.id, agent.schedule, agent.schedule_overlap, agent.schedule_mode);
      }
    }

    this.logger('info', `Daemon initialized. ${this.agents.size} agent(s) loaded.`);
  }

  async shutdown(): Promise<void> {
    this.logger('info', 'Graceful shutdown starting...');
    this.scheduler.shutdown();

    // Clear all idle timers
    for (const managed of this.agents.values()) {
      if (managed.idleTimer) {
        clearTimeout(managed.idleTimer);
        managed.idleTimer = undefined;
      }
    }

    const stopPromises: Promise<void>[] = [];
    for (const [, managed] of this.agents) {
      for (const [runId] of managed.runs) {
        stopPromises.push(this.stopRun(managed.agent.id, runId, 'daemon shutdown'));
      }
    }
    await Promise.allSettled(stopPromises);

    await Promise.allSettled(
      [...this.agents.values()]
        .filter(m => m.agent.status !== 'disabled')
        .map(m => Agent.update({ status: 'idle' }, { where: { id: m.agent.id } }))
    );

    await Promise.allSettled(
      [...this.agents.values()].map(m => this.docker.stopContainer(m.agent.container_id))
    );

    this.sse.closeAll();
    this.logger('info', 'Graceful shutdown complete.');
  }

  forceShutdown(): void {
    this.logger('warn', 'Force shutdown — killing all children.');
    for (const [, managed] of this.agents) {
      for (const [, run] of managed.runs) {
        if (!run.process.killed) {
          run.process.kill('SIGKILL');
        }
      }
    }
  }

  // ── Agent CRUD ──

  async createAgent(input: {
    name: string;
    system_prompt: string;
    tools: string[];
    cwd: string;
    user_id: string;
    parent_agent_id?: string | null;
    folder_id?: string;
    model?: string;
    schedule?: string;
    schedule_overlap?: 'skip' | 'queue' | 'kill';
    schedule_mode?: 'new' | 'continue';
    max_turns?: number;
    timeout_ms?: number;
    metadata?: Record<string, unknown>;
    docker_image?: string;
    mounts?: { host: string; container: string; readonly?: boolean }[];
    resource_limits?: Partial<AgentResourceLimits>;
  }): Promise<ReturnType<Agent['toApi']>> {
    // Validate parent exists if specified
    if (input.parent_agent_id) {
      const parent = this.agents.get(input.parent_agent_id);
      if (!parent) throw new Error(`Parent agent not found: ${input.parent_agent_id}`);
    }

    // Resolve folder: explicit, or user's root folder
    let folderId = input.folder_id;
    if (!folderId) {
      const Folder = (await import('../db/models/Folder.js')).default;
      const root = await Folder.ensureRootForUser(input.user_id);
      folderId = root.id;
    }

    const resourceLimits = resolveAgentResourceLimits(input.resource_limits);

    const agent = await Agent.create({
      name: input.name,
      system_prompt: input.system_prompt,
      tools: input.tools,
      cwd: input.cwd,
      user_id: input.user_id,
      parent_agent_id: input.parent_agent_id ?? null,
      folder_id: folderId,
      model: input.model ?? DEFAULT_MODEL,
      schedule: input.schedule ?? null,
      schedule_overlap: input.schedule_overlap ?? 'skip',
      schedule_mode: input.schedule_mode ?? 'new',
      max_turns: input.max_turns ?? DEFAULT_MAX_TURNS,
      timeout_ms: input.timeout_ms ?? DEFAULT_TIMEOUT_MS,
      metadata: input.metadata ?? null,
      docker_image: input.docker_image ?? DEFAULT_DOCKER_IMAGE,
      mounts: input.mounts ?? [],
      container_cpus: resourceLimits.cpus,
      container_memory_mb: resourceLimitsToDockerMemoryMb(resourceLimits),
      container_pids_limit: resourceLimits.pids_limit,
    });

    this.agents.set(agent.id, { agent, runs: new Map(), terminals: 0 });
    if (agent.schedule) {
      this.scheduler.register(agent.id, agent.schedule, agent.schedule_overlap, agent.schedule_mode);
    }
    this.logger('info', `Agent created: "${agent.name}" (${agent.id})`);

    return agent.toApi();
  }

  // ── Container idle management ──

  /** Schedule a container pause after CONTAINER_IDLE_MS if nothing holds it. */
  private scheduleIdleCheck(agentId: string): void {
    const managed = this.agents.get(agentId);
    if (!managed) return;

    if (managed.idleTimer) {
      clearTimeout(managed.idleTimer);
      managed.idleTimer = undefined;
    }

    // Something actively using the container — don't schedule
    if (managed.runs.size > 0 || managed.terminals > 0) return;

    managed.idleTimer = setTimeout(() => {
      managed.idleTimer = undefined;
      if (managed.runs.size === 0 && managed.terminals === 0) {
        this.docker.pauseContainer(managed.agent.container_id).catch(() => {});
      }
    }, CONTAINER_IDLE_MS);
  }

  /** Called when a terminal WebSocket connects to this agent. */
  terminalConnected(agentId: string): void {
    const managed = this.agents.get(agentId);
    if (!managed) return;
    managed.terminals++;
    if (managed.idleTimer) {
      clearTimeout(managed.idleTimer);
      managed.idleTimer = undefined;
    }
  }

  /** Called when a terminal WebSocket disconnects. */
  terminalDisconnected(agentId: string): void {
    const managed = this.agents.get(agentId);
    if (!managed) return;
    managed.terminals = Math.max(0, managed.terminals - 1);
    this.scheduleIdleCheck(agentId);
  }

  async updateAgent(id: string, updates: Partial<{
    name: string;
    system_prompt: string;
    tools: string[];
    cwd: string;
    parent_agent_id: string | null;
    folder_id: string;
    model: string;
    schedule: string | null;
    schedule_overlap: 'skip' | 'queue' | 'kill';
    schedule_mode: 'new' | 'continue';
    max_turns: number;
    timeout_ms: number;
    metadata: Record<string, unknown>;
    docker_image: string;
    mounts: { host: string; container: string; readonly?: boolean }[];
    resource_limits: Partial<AgentResourceLimits>;
    status: AgentStatus;
    propagate_children: boolean;
  }>): Promise<ReturnType<Agent['toApi']>> {
    const managed = this.agents.get(id);
    if (!managed) throw new Error(`Agent not found: ${id}`);

    // Validate parent_agent_id change — prevent cycles
    if ('parent_agent_id' in updates && updates.parent_agent_id !== undefined) {
      if (updates.parent_agent_id && this.wouldCreateCycle(id, updates.parent_agent_id)) {
        throw new Error('Cannot set parent: would create a cycle');
      }
    }

    // If mounts or docker_image changed, destroy the container so it's
    // recreated with the new config on the next run (volume is preserved).
    const needsRecreate = 'mounts' in updates || 'docker_image' in updates || 'resource_limits' in updates;

    const nextUpdates: Record<string, unknown> = { ...updates };
    delete nextUpdates.propagate_children;

    if ('resource_limits' in updates) {
      const resourceLimits = resolveAgentResourceLimits(
        updates.resource_limits,
        agentResourceLimitsFromValues(managed.agent),
      );
      nextUpdates.container_cpus = resourceLimits.cpus;
      nextUpdates.container_memory_mb = resourceLimitsToDockerMemoryMb(resourceLimits);
      nextUpdates.container_pids_limit = resourceLimits.pids_limit;
      delete nextUpdates.resource_limits;
    }

    await managed.agent.update(nextUpdates);

    // Re-register schedule if schedule or overlap changed
    if ('schedule' in updates || 'schedule_overlap' in updates || 'schedule_mode' in updates) {
      this.scheduler.register(id, managed.agent.schedule, managed.agent.schedule_overlap);
    }

    if (needsRecreate && managed.runs.size === 0) {
      await this.docker.destroyContainer(managed.agent.container_id);
    }

    // Propagate model to all descendants if requested
    if ('model' in updates && updates.model && (updates as any).propagate_children) {
      const descendants = this.collectDescendants(id);
      for (const childId of descendants) {
        const child = this.agents.get(childId);
        if (child) await child.agent.update({ model: updates.model });
      }
    }

    return managed.agent.toApi();
  }

  async deleteAgent(id: string): Promise<void> {
    // Cascade delete: collect all descendants first, then delete leaf-to-root
    const descendants = this.collectDescendants(id);
    const toDelete = [...descendants.reverse(), id]; // children first, then self

    for (const agentId of toDelete) {
      this.scheduler.unregister(agentId);
      const managed = this.agents.get(agentId);
      if (managed && managed.runs.size > 0) {
        await this.stopAllRuns(agentId, 'agent deleted');
      }

      if (managed) {
        await this.docker.removeContainer(managed.agent.container_id);
      }

      await AgentLog.destroy({ where: { agent_id: agentId } }); // hard delete (no paranoid)
      // Soft-delete agent — afterDestroy hooks cascade to runs → messages
      await Agent.destroy({ where: { id: agentId }, individualHooks: true });
      this.agents.delete(agentId);

      this.logger('info', `Agent deleted: ${agentId}`);
    }
  }

  async getAgent(id: string): Promise<ReturnType<Agent['toApi']> & { next_run: string | null } | null> {
    const managed = this.agents.get(id);
    if (!managed) return null;
    const nextRun = this.scheduler.getNextRun(id);
    return { ...managed.agent.toApi(), next_run: nextRun?.toISOString() ?? null };
  }

  async listAgents(userId: string, folder_id?: string): Promise<(ReturnType<Agent['toApi']> & { next_run: string | null })[]> {
    const all = [...this.agents.values()].map(m => m.agent).filter(a => a.user_id === userId);
    const filtered = folder_id ? all.filter(a => a.folder_id === folder_id) : all;
    return filtered.map(a => ({
      ...a.toApi(),
      next_run: this.scheduler.getNextRun(a.id)?.toISOString() ?? null,
    }));
  }

  /** Total agent count (all users) — for startup banner. */
  agentCount(): number {
    return this.agents.size;
  }

  isRunning(agentId: string): boolean {
    return this.hasActiveRuns(agentId);
  }

  hasActiveRuns(agentId: string): boolean {
    const managed = this.agents.get(agentId);
    return managed ? managed.runs.size > 0 : false;
  }

  /** Find a live run by runId within an agent's active runs */
  getActiveRun(agentId: string, runId?: string): ManagedRun | undefined {
    const managed = this.agents.get(agentId);
    if (!managed) return undefined;
    if (runId) return managed.runs.get(runId);
    // No runId specified — return the most recently added active run
    let latest: ManagedRun | undefined;
    for (const run of managed.runs.values()) latest = run;
    return latest;
  }

  // ── Run Management ──

  async startRun(agentId: string, trigger: TriggerType = 'manual', input?: string, images?: { base64: string; mediaType: string }[]): Promise<string> {
    const managed = this.agents.get(agentId);
    if (!managed) throw new Error(`Agent not found: ${agentId}`);

    await this.docker.ensureContainer(managed.agent, this.findRootAgentId(agentId));

    const run = await Run.create({
      cwd: managed.agent.cwd,
      model: managed.agent.model,
      agent_id: agentId,
      trigger,
    });

    await this.forkWorker(agentId, run.id, null, {
      type: 'start', agentId, runId: run.id, trigger, input, images,
      schedule: managed.agent.schedule || undefined,
    });

    this.logger('info', `Agent "${managed.agent.name}" run started (run: ${run.id})`);
    return run.id;
  }

  async continueRun(agentId: string, runId: string, input?: string, images?: { base64: string; mediaType: string }[]): Promise<void> {
    const managed = this.agents.get(agentId);
    if (!managed) throw new Error(`Agent not found: ${agentId}`);

    // If this run already has a live worker (e.g. paused), use inject/resume instead
    const activeRun = managed.runs.get(runId);
    if (activeRun) {
      if (activeRun.status === 'paused') {
        // Ensure the container is running — it may have been paused by OrbStack
        // (e.g. laptop sleep) while the agent was waiting for user input.
        await this.docker.ensureContainer(managed.agent, this.findRootAgentId(agentId));
        activeRun.process.send({ type: 'resume', message: input } as ParentMessage);
        activeRun.status = 'running';
        await this.deriveAgentStatus(agentId);
        await this.updateRunStatus(agentId, runId, 'running');
        return;
      }
      throw new Error(`Run ${runId} is already running`);
    }

    const run = await Run.findByPk(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);

    await this.docker.ensureContainer(managed.agent, this.findRootAgentId(agentId));

    await this.forkWorker(agentId, runId, null, {
      type: 'start', agentId, runId, trigger: 'manual', input, images, resume: true,
    });

    this.logger('info', `Agent "${managed.agent.name}" run continued (run: ${runId})`);
  }

  private async forkWorker(agentId: string, runId: string, parentRunId: string | null, startMsg: ParentMessage): Promise<void> {
    const managed = this.agents.get(agentId)!;

    // Per-user API keys — passed via IPC, not env, to avoid overriding system vars.
    const secrets = await UserSecret.getSecrets(managed.agent.user_id);
    if (startMsg.type === 'start') {
      startMsg.secrets = secrets;

      // Shared secrets: controls which server-side .env keys fall through to this worker.
      // Local mode / admin: null → allow all env (current behavior).
      // Production non-admin: restricted to TAURUS_SHARED_SECRETS list.
      const user = await User.findByPk(managed.agent.user_id, { attributes: ['role'] });
      const isAdmin = user?.role === 'admin';
      const isLocal = process.env.NODE_ENV === 'local';
      startMsg.sharedSecrets = (isLocal || isAdmin) ? null : parseSharedSecrets();
    }

    const child = fork(WORKER_PATH, [], {
      execArgv: ['--import', 'tsx'],
      serialization: 'advanced',
    });

    managed.runs.set(runId, {
      runId,
      process: child,
      parentRunId,
      callerRequestId: null,
      callerType: null,
      callerAgentId: null,
      callerRunId: null,
      status: 'running',
    });

    child.on('message', (msg: ChildMessage) => {
      this.handleChildMessage(agentId, runId, msg);
    });

    child.on('exit', (code) => {
      this.handleChildExit(agentId, runId, code);
    });

    child.on('error', (err) => {
      this.logger('error', `Agent "${managed.agent.name}" run ${runId} process error: ${err.message}`);
    });

    await new Promise<void>((resolve) => {
      const onMessage = (msg: ChildMessage) => {
        if (msg.type === 'ready') {
          child.off('message', onMessage);
          resolve();
        }
      };
      child.on('message', onMessage);
      setTimeout(resolve, 10_000);
    });

    child.send(startMsg);
    await this.deriveAgentStatus(agentId);
    await this.updateRunStatus(agentId, runId, 'running');
  }

  async stopRun(agentId: string, runId: string, reason: string = 'user requested'): Promise<void> {
    const managed = this.agents.get(agentId);
    if (!managed) return;

    const run = managed.runs.get(runId);
    if (!run) return;

    const stopMsg: ParentMessage = { type: 'stop', reason };
    run.process.send(stopMsg);

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (!run.process.killed) {
          run.process.kill('SIGKILL');
        }
        resolve();
      }, 10_000);

      run.process.on('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });

    await this.updateRunStatus(agentId, runId, 'stopped');
  }

  /** Stop top-level runs only — cascade kill handles their children */
  async stopAllRuns(agentId: string, reason: string = 'user requested'): Promise<void> {
    const managed = this.agents.get(agentId);
    if (!managed) return;
    const topLevel = [...managed.runs.values()].filter(r => !r.parentRunId);
    await Promise.allSettled(topLevel.map(r => this.stopRun(agentId, r.runId, reason)));
  }

  async injectMessage(agentId: string, message: string, images?: { base64: string; mediaType: string }[], runId?: string): Promise<void> {
    const managed = this.agents.get(agentId);
    if (!managed) throw new Error(`Agent not found: ${agentId}`);

    const run = runId ? managed.runs.get(runId) : this.getActiveRun(agentId);
    if (!run) throw new Error('No active run to inject into');

    if (run.status === 'paused') {
      await this.docker.ensureContainer(managed.agent, this.findRootAgentId(agentId));
      run.process.send({ type: 'resume', message } as ParentMessage);
      run.status = 'running';
      await this.deriveAgentStatus(agentId);
      await this.updateRunStatus(agentId, run.runId, 'running');
      return;
    }

    const msg: ParentMessage = { type: 'inject', message, images };
    run.process.send(msg);
  }

  // ── Smart message dispatch ──

  /**
   * Single entry point for sending a message to an agent.
   * Auto-dispatches based on run state:
   *   run is running → inject into it
   *   run is paused  → resume it with message
   *   run is idle    → continue it with message
   *   no run_id      → start a new run
   */
  async sendMessage(
    agentId: string,
    message: string,
    opts?: { images?: { base64: string; mediaType: string }[]; run_id?: string },
  ): Promise<string> {
    const managed = this.agents.get(agentId);
    if (!managed) throw new Error(`Agent not found: ${agentId}`);

    const images = opts?.images;
    const runId = opts?.run_id;

    if (!runId) {
      return this.startRun(agentId, 'manual', message, images);
    }

    // Check if this run has a live worker
    const activeRun = managed.runs.get(runId);
    if (activeRun) {
      if (activeRun.status === 'running') {
        await this.injectMessage(agentId, message, images, runId);
        return runId;
      }
      if (activeRun.status === 'paused') {
        await this.continueRun(agentId, runId, message, images);
        return runId;
      }
    }

    // Idle run — continue it
    await this.continueRun(agentId, runId, message, images);
    return runId;
  }

  // ── Blocking ask (for /api/ask) ──

  /** Returns any active run's ID for this agent. Prefers running over paused. */
  getCurrentRunId(agentId: string): string | null {
    const managed = this.agents.get(agentId);
    if (!managed) return null;
    let pausedId: string | null = null;
    for (const run of managed.runs.values()) {
      if (run.status === 'running') return run.runId;
      if (run.status === 'paused') pausedId = run.runId;
    }
    return pausedId;
  }

  findAgentByName(userId: string, name: string): Agent | null {
    for (const managed of this.agents.values()) {
      if (managed.agent.user_id === userId && managed.agent.name === name) return managed.agent;
    }
    return null;
  }

  // ── Hierarchy helpers ──

  /** Walk up parent_agent_id chain to find the root of an agent's tree.
   *  Uses the in-memory agents Map — no DB queries. */
  findRootAgentId(agentId: string): string {
    let current = agentId;
    const visited = new Set<string>();
    while (true) {
      visited.add(current);
      const parentId = this.agents.get(current)?.agent.parent_agent_id;
      if (!parentId || visited.has(parentId)) return current;
      current = parentId;
    }
  }

  getChildren(agentId: string): Agent[] {
    const children: Agent[] = [];
    for (const managed of this.agents.values()) {
      if (managed.agent.parent_agent_id === agentId) children.push(managed.agent);
    }
    return children;
  }

  findChildByName(parentId: string, childName: string): Agent | null {
    for (const managed of this.agents.values()) {
      if (managed.agent.parent_agent_id === parentId && managed.agent.name === childName) {
        return managed.agent;
      }
    }
    return null;
  }

  /** Walk a path like "agency/researcher/fact_checker" to resolve an agent. */
  findAgentByPath(path: string): Agent | null {
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 0) return null;

    // First segment: top-level agent (parent_agent_id = null)
    let current: Agent | null = null;
    for (const managed of this.agents.values()) {
      if (managed.agent.parent_agent_id === null && managed.agent.name === parts[0]) {
        current = managed.agent;
        break;
      }
    }
    if (!current) return null;

    // Walk remaining segments
    for (let i = 1; i < parts.length; i++) {
      current = this.findChildByName(current.id, parts[i]);
      if (!current) return null;
    }
    return current;
  }

  /** Check if setting proposedParentId as parent of agentId would create a cycle. */
  wouldCreateCycle(agentId: string, proposedParentId: string): boolean {
    let current: string | null = proposedParentId;
    while (current) {
      if (current === agentId) return true;
      const managed = this.agents.get(current);
      current = managed?.agent.parent_agent_id ?? null;
    }
    return false;
  }

  /** Collect all descendant agent IDs (depth-first). */
  private collectDescendants(agentId: string): string[] {
    const descendants: string[] = [];
    const stack = [agentId];
    while (stack.length > 0) {
      const parentId = stack.pop()!;
      for (const managed of this.agents.values()) {
        if (managed.agent.parent_agent_id === parentId) {
          descendants.push(managed.agent.id);
          stack.push(managed.agent.id);
        }
      }
    }
    return descendants;
  }

  awaitRunCompletion(runId: string, timeoutMs: number = 300_000): Promise<{ summary: string; error?: string; tokens?: { input: number; output: number; cost: number }; hitMaxTurns?: boolean }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const list = this.completionWaiters.get(runId);
        if (list) {
          const idx = list.findIndex(w => w.resolve === resolve);
          if (idx !== -1) list.splice(idx, 1);
          if (list.length === 0) this.completionWaiters.delete(runId);
        }
        reject(new Error('Timeout waiting for run completion'));
      }, timeoutMs);

      const waiters = this.completionWaiters.get(runId) ?? [];
      waiters.push({ resolve, timer });
      this.completionWaiters.set(runId, waiters);
    });
  }

  private notifyRunCompletion(runId: string, result: { summary: string; error?: string; tokens?: { input: number; output: number; cost: number }; hitMaxTurns?: boolean }): void {
    const waiters = this.completionWaiters.get(runId);
    if (waiters) {
      for (const { resolve, timer } of waiters) {
        clearTimeout(timer);
        resolve(result);
      }
      this.completionWaiters.delete(runId);
    }
  }

  // ── IPC Handling (coordination + SSE only) ──

  private async handleChildMessage(agentId: string, runId: string, msg: ChildMessage): Promise<void> {
    const managed = this.agents.get(agentId);
    if (!managed) return;

    switch (msg.type) {
      case 'ready':
        break;

      case 'log': {
        if (msg.event === 'llm.thinking') {
          this.sse.broadcast(agentId, {
            type: 'llm_thinking',
            agentId,
            runId,
            text: msg.message,
          });
          break;
        }

        if (msg.event === 'llm.text') {
          this.sse.broadcast(agentId, {
            type: 'llm_text',
            agentId,
            runId,
            text: msg.message,
          });
          break;
        }

        if (msg.event === 'tool.output') {
          this.sse.broadcast(agentId, {
            type: 'tool_output',
            agentId,
            runId,
            text: msg.message,
          });
          break;
        }

        if (msg.level !== 'debug') {
          this.logger(msg.level, `[${managed.agent.name}] ${msg.message}`);

          this.sse.broadcast(agentId, {
            type: 'log',
            agentId,
            runId,
            level: msg.level,
            event: msg.event,
            message: msg.message,
            data: msg.data,
            timestamp: new Date().toISOString(),
          });
        }
        break;
      }

      case 'status': {
        // Update the in-memory run status
        const run = managed.runs.get(runId);
        if (run && (msg.status === 'running' || msg.status === 'paused')) {
          run.status = msg.status;
        }
        await this.deriveAgentStatus(agentId);
        break;
      }

      case 'paused': {
        const run = managed.runs.get(runId);
        if (run) run.status = 'paused';
        await this.deriveAgentStatus(agentId);
        await this.updateRunStatus(agentId, runId, 'paused');
        this.logger('info', `[${managed.agent.name}] Paused: ${msg.reason}`);
        this.sse.broadcast(agentId, {
          type: 'agent_paused',
          agentId,
          reason: msg.reason,
          timestamp: new Date().toISOString(),
        });
        break;
      }

      case 'run_complete': {
        this.logger('info', `[${managed.agent.name}] Run complete. Tokens: ${msg.tokens.input}in/${msg.tokens.output}out`);
        // Notify waiters synchronously before any awaits — prevents race with handleChildExit
        this.notifyRunCompletion(runId, { summary: msg.summary, error: msg.error, tokens: msg.tokens, hitMaxTurns: msg.hitMaxTurns });

        // Route result back to the caller (subrun parent or delegator)
        const completedRun = managed.runs.get(runId);
        if (completedRun?.callerType) {
          if (completedRun.callerRequestId) {
            // Blocking mode: route result directly to the waiting tool call
            this.routeResultToCaller(completedRun, agentId, runId, msg.summary, msg.error, msg.tokens, msg.images, msg.hitMaxTurns);
            completedRun.callerRequestId = null;
          } else {
            // Background mode: notify the source run that dispatched this work
            this.notifyCallerOfBackgroundCompletion(completedRun, agentId, runId, msg.summary, msg.error, msg.hitMaxTurns);
          }
        }

        await this.updateRunStatus(agentId, runId, msg.error ? 'error' : 'completed', msg.error || undefined);
        this.scheduler.onRunComplete(agentId);

        this.sse.broadcast(agentId, {
          type: 'run_complete',
          agentId,
          runId,
          summary: msg.summary,
          error: msg.error,
          tokens: msg.tokens,
          timestamp: new Date().toISOString(),
        });
        break;
      }

      case 'subrun_request':
        this.handleSubrunRequest(agentId, runId, msg).catch((err: any) => {
          this.logger('error', `[${managed.agent.name}] Subrun failed: ${err.message}`);
          const parentRun = managed.runs.get(runId);
          if (parentRun) {
            parentRun.process.send({ type: 'subrun_result', requestId: msg.requestId, runId: '', summary: '', error: err.message } as ParentMessage);
          }
        });
        break;

      case 'delegate_request':
        this.handleDelegateRequest(agentId, runId, msg).catch((err: any) => {
          this.logger('error', `[${managed.agent.name}] Delegate failed: ${err.message}`);
          const callerRun = managed.runs.get(runId);
          if (callerRun) {
            callerRun.process.send({ type: 'delegate_result', requestId: msg.requestId, runId: '', summary: '', error: err.message } as ParentMessage);
          }
        });
        break;

      case 'supervisor_request':
        this.handleSupervisorRequest(agentId, runId, msg).catch((err: any) => {
          this.logger('error', `[${managed.agent.name}] Supervisor request failed: ${err.message}`);
        });
        break;

      case 'wait_request':
        this.handleWaitRequest(agentId, runId, msg).catch((err: any) => {
          this.logger('error', `[${managed.agent.name}] Wait failed: ${err.message}`);
          const callerRun = managed.runs.get(runId);
          if (callerRun) {
            callerRun.process.send({ type: 'wait_result', requestId: msg.requestId, completed: {}, pending: [], } as unknown as ParentMessage);
          }
        });
        break;

      case 'signal_emit':
        if (msg.name === 'notify') {
          const payload = (msg.payload ?? {}) as {
            title?: string;
            message?: string;
            level?: 'info' | 'success' | 'warning' | 'error';
            tag?: string;
          };
          const message = payload.message?.trim();

          if (message) {
            this.logger('info', `[${managed.agent.name}] Notification: ${message}`);
            this.broadcastNotificationToUser(managed.agent.user_id, {
              type: 'agent_notification',
              agentId,
              agentName: managed.agent.name,
              runId,
              title: payload.title?.trim() || managed.agent.name,
              message,
              level: payload.level ?? 'info',
              tag: payload.tag,
              timestamp: new Date().toISOString(),
            });
            break;
          }
        }

        // TODO: route generic signals to other agents
        this.logger('info', `[${managed.agent.name}] Signal emitted: ${msg.name}`);
        break;

      case 'error': {
        this.logger('error', `[${managed.agent.name}] Error: ${msg.error}`);
        this.notifyRunCompletion(runId, { summary: '', error: msg.error });

        // Route error to caller (subrun parent or delegator)
        const erroredRun = managed.runs.get(runId);
        if (erroredRun?.callerRequestId) {
          this.routeResultToCaller(erroredRun, agentId, runId, '', msg.error);
          erroredRun.callerRequestId = null;
        }

        await this.updateRunStatus(agentId, runId, 'error', msg.error);

        this.sse.broadcast(agentId, {
          type: 'agent_error',
          agentId,
          error: msg.error,
          timestamp: new Date().toISOString(),
        });
        break;
      }
    }
  }

  private async handleSubrunRequest(
    agentId: string,
    parentRunId: string,
    msg: { requestId: string; input: string; tools?: string[]; max_turns?: number; timeout_ms?: number; run_id?: string; background?: boolean },
  ): Promise<void> {
    const managed = this.agents.get(agentId);
    if (!managed) throw new Error(`Agent not found: ${agentId}`);

    // Container is already running (parent is active) — no ensureContainer needed

    // Enforce tool subsetting: child tools must be a subset of the parent agent's tools.
    const parentTools = new Set(managed.agent.tools as string[]);
    const childTools = msg.tools
      ? msg.tools.filter(t => parentTools.has(t))
      : undefined; // undefined = inherit parent's full set

    let runId: string;

    if (msg.run_id) {
      // Resume an existing subrun
      const existingRun = await Run.findByPk(msg.run_id);
      if (!existingRun) throw new Error(`Run not found: ${msg.run_id}`);
      if (existingRun.agent_id !== agentId) throw new Error(`Run ${msg.run_id} does not belong to this agent`);

      const activeRun = managed.runs.get(msg.run_id);
      if (activeRun) throw new Error(`Subrun ${msg.run_id} is already running`);

      runId = msg.run_id;
      await this.forkWorker(agentId, runId, parentRunId, {
        type: 'start',
        agentId,
        runId,
        trigger: 'subrun',
        input: msg.input,
        tools: childTools,
        resume: true,
      });
    } else {
      // Start a fresh subrun
      const childRun = await Run.create({
        cwd: managed.agent.cwd,
        model: managed.agent.model,
        agent_id: agentId,
        trigger: 'manual',
        parent_run_id: parentRunId,
      });
      runId = childRun.id;

      await this.forkWorker(agentId, runId, parentRunId, {
        type: 'start',
        agentId,
        runId,
        trigger: 'subrun',
        input: msg.input,
        tools: childTools,
      });
    }

    const childManagedRun = managed.runs.get(runId);
    if (childManagedRun) {
      // Always store caller info so we can notify on completion
      childManagedRun.callerType = 'subrun';
      if (msg.background) {
        // Background mode: respond immediately, no callerRequestId (no blocking routing)
        const callerRun = managed.runs.get(parentRunId);
        if (callerRun) {
          callerRun.process.send({
            type: 'subrun_result',
            requestId: msg.requestId,
            runId,
            summary: '',
          } as ParentMessage);
        }
      } else {
        // Blocking mode: tag so run_complete routes the result back
        childManagedRun.callerRequestId = msg.requestId;
      }
    }

    this.logger('info', `[${managed.agent.name}] Subrun ${runId} (parent: ${parentRunId}${msg.background ? ', background' : ''})`);
  }

  private async handleDelegateRequest(
    callerAgentId: string,
    callerRunId: string,
    msg: { requestId: string; targetAgent: string; input: string; context?: string; run_id?: string; background?: boolean },
  ): Promise<void> {
    // Resolve target: must be a direct child of the caller
    const targetAgent = this.findChildByName(callerAgentId, msg.targetAgent);
    if (!targetAgent) {
      const callerManaged = this.agents.get(callerAgentId);
      throw new Error(`Agent "${msg.targetAgent}" is not a child of "${callerManaged?.agent.name ?? callerAgentId}"`);
    }

    const targetManaged = this.agents.get(targetAgent.id);
    if (!targetManaged) throw new Error(`Target agent not loaded: ${targetAgent.id}`);

    // Ensure the child's container is running (lazy start)
    await this.docker.ensureContainer(targetAgent, this.findRootAgentId(targetAgent.id));

    let runId: string;

    if (msg.run_id) {
      // Resume a specific run
      const existingRun = await Run.findByPk(msg.run_id);
      if (!existingRun) throw new Error(`Run not found: ${msg.run_id}`);
      if (existingRun.agent_id !== targetAgent.id) throw new Error(`Run ${msg.run_id} does not belong to agent "${msg.targetAgent}"`);

      const activeRun = targetManaged.runs.get(msg.run_id);
      if (activeRun) throw new Error(`Agent "${msg.targetAgent}" is already running (run ${msg.run_id})`);

      runId = msg.run_id;
      await this.forkWorker(targetAgent.id, runId, callerRunId, {
        type: 'start',
        agentId: targetAgent.id,
        runId,
        trigger: 'delegate',
        input: msg.input,
        resume: true,
      });
    } else {
      // Start a fresh run
      const childRun = await Run.create({
        cwd: targetAgent.cwd,
        model: targetAgent.model,
        agent_id: targetAgent.id,
        trigger: 'delegate',
        parent_run_id: callerRunId,
      });
      runId = childRun.id;

      await this.forkWorker(targetAgent.id, runId, callerRunId, {
        type: 'start',
        agentId: targetAgent.id,
        runId,
        trigger: 'delegate',
        input: msg.input,
      });
    }

    // Tag the child run for cross-agent routing
    const childManagedRun = targetManaged.runs.get(runId);
    if (childManagedRun) {
      // Always store caller info so we can notify on completion
      childManagedRun.callerType = 'delegate';
      childManagedRun.callerAgentId = callerAgentId;
      childManagedRun.callerRunId = callerRunId;
      if (msg.background) {
        // Background mode: respond immediately, no callerRequestId (no blocking routing)
        const callerManaged = this.agents.get(callerAgentId);
        const callerRun = callerManaged?.runs.get(callerRunId);
        if (callerRun) {
          callerRun.process.send({
            type: 'delegate_result',
            requestId: msg.requestId,
            summary: '',
            runId,
          } as ParentMessage);
        }
      } else {
        // Blocking mode: tag so run_complete routes the result back
        childManagedRun.callerRequestId = msg.requestId;
      }
    }

    const callerManaged = this.agents.get(callerAgentId);
    const action = msg.run_id ? 'Resumed delegation' : 'Delegated';
    this.logger('info', `[${callerManaged?.agent.name}] ${action} to "${msg.targetAgent}" → run ${runId}${msg.background ? ' (background)' : ''}`);
  }

  /**
   * Handle supervisor tool requests (ListTeam, CreateAgent, etc.)
   * These are synchronous operations that don't need a child worker.
   */
  private async handleSupervisorRequest(
    callerAgentId: string,
    callerRunId: string,
    msg: { requestId: string; action: string; params: Record<string, unknown> },
  ): Promise<void> {
    const callerManaged = this.agents.get(callerAgentId);
    if (!callerManaged) return;

    const callerRun = callerManaged.runs.get(callerRunId);
    if (!callerRun) return;

    let result: unknown;
    try {
      switch (msg.action) {
        case 'list_team': {
          const children = this.getChildren(callerAgentId);
          const teamResults = [];
          for (const c of children) {
            const cm = this.agents.get(c.id);
            const latestRun = cm ? [...cm.runs.values()].pop() : undefined;
            let runInfo: Record<string, unknown> | null = null;
            if (latestRun) {
              const run = await Run.findByPk(latestRun.runId);
              const msgCount = run ? await Message.count({ where: { run_id: run.id } }) : 0;
              const lastMsg = run ? await Message.findOne({ where: { run_id: run.id }, order: [['seq', 'DESC']] }) : null;
              runInfo = {
                id: latestRun.runId,
                status: latestRun.status,
                started_at: run?.created_at ?? null,
                message_count: msgCount,
                last_message_at: lastMsg?.created_at ?? null,
              };
            }
            teamResults.push({
              key: c.name,
              status: c.status,
              currentRun: runInfo,
            });
          }
          result = teamResults;
          break;
        }

        case 'create_agent': {
          const p = msg.params as {
            key: string;
            system_prompt: string;
            tools?: string[];
            model?: string;
            docker_image?: string;
            resource_limits?: Partial<AgentResourceLimits>;
          };
          const created = await this.createAgent({
            name: p.key,
            system_prompt: p.system_prompt,
            tools: p.tools ?? ['Read', 'Glob', 'Grep'],
            cwd: callerManaged.agent.cwd,
            user_id: callerManaged.agent.user_id,
            parent_agent_id: callerAgentId,
            model: p.model ?? callerManaged.agent.model,
            docker_image: p.docker_image ?? callerManaged.agent.docker_image,
            resource_limits: p.resource_limits ?? agentResourceLimitsFromValues(callerManaged.agent),
          });
          result = { id: created.id, key: created.name };
          break;
        }

        case 'update_agent': {
          const p = msg.params as {
            key: string;
            system_prompt?: string;
            tools?: string[];
            model?: string;
            resource_limits?: Partial<AgentResourceLimits>;
          };
          const child = this.findChildByName(callerAgentId, p.key);
          if (!child) throw new Error(`Child "${p.key}" not found`);
          const updates: Record<string, unknown> = {};
          if (p.system_prompt !== undefined) updates.system_prompt = p.system_prompt;
          if (p.tools !== undefined) updates.tools = p.tools;
          if (p.model !== undefined) updates.model = p.model;
          if (p.resource_limits !== undefined) updates.resource_limits = p.resource_limits;
          await this.updateAgent(child.id, updates as any);
          result = { ok: true };
          break;
        }

        case 'delete_agent': {
          const p = msg.params as { key: string };
          const child = this.findChildByName(callerAgentId, p.key);
          if (!child) throw new Error(`Child "${p.key}" not found`);
          await this.deleteAgent(child.id);
          result = { ok: true };
          break;
        }

        case 'inspect_run': {
          const p = msg.params as { key: string; run_id?: string };
          const child = this.findChildByName(callerAgentId, p.key);
          if (!child) throw new Error(`Child "${p.key}" not found`);
          const targetRunId = p.run_id;
          const run = targetRunId
            ? await Run.findByPk(targetRunId)
            : (await Run.findAll({ where: { agent_id: child.id }, order: [['created_at', 'DESC']], limit: 1 }))[0];
          if (!run) {
            result = { status: 'no_runs' };
          } else {
            const totalMessages = await Message.count({ where: { run_id: run.id } });
            const messages = await Message.findAll({
              where: { run_id: run.id },
              order: [['seq', 'DESC']],
              limit: 5,
            });
            const isTerminal = ['completed', 'error', 'stopped'].includes(run.status);
            result = {
              id: run.id,
              status: run.status,
              trigger: run.trigger,
              started_at: run.created_at,
              ...(isTerminal ? { completed_at: run.updated_at } : {}),
              message_count: totalMessages,
              messages: messages.reverse().map(m => ({
                role: m.role,
                content: typeof m.content === 'string'
                  ? m.content
                  : JSON.stringify(m.content),
                created_at: m.created_at,
              })),
            };
          }
          break;
        }

        case 'inject_message': {
          const p = msg.params as { key: string; message: string };
          const child = this.findChildByName(callerAgentId, p.key);
          if (!child) throw new Error(`Child "${p.key}" not found`);
          await this.injectMessage(child.id, p.message);
          result = { ok: true };
          break;
        }

        case 'stop_run': {
          const p = msg.params as { key: string; run_id?: string };
          const child = this.findChildByName(callerAgentId, p.key);
          if (!child) throw new Error(`Child "${p.key}" not found`);
          await this.stopAllRuns(child.id, 'supervisor stopped');
          result = { ok: true };
          break;
        }

        default:
          throw new Error(`Unknown supervisor action: ${msg.action}`);
      }

      callerRun.process.send({
        type: 'supervisor_result',
        requestId: msg.requestId,
        result,
      });
    } catch (err: any) {
      callerRun.process.send({
        type: 'supervisor_result',
        requestId: msg.requestId,
        result: null,
        error: err.message,
      });
    }
  }

  private async handleWaitRequest(
    agentId: string,
    callerRunId: string,
    msg: { requestId: string; run_ids?: string[]; timeout_ms?: number },
  ): Promise<void> {
    const managed = this.agents.get(agentId);
    if (!managed) throw new Error(`Agent not found: ${agentId}`);

    const callerRun = managed.runs.get(callerRunId);
    if (!callerRun) throw new Error(`Caller run not found: ${callerRunId}`);

    const timeoutMs = msg.timeout_ms ?? 300_000;

    if (!msg.run_ids?.length) {
      // Pure sleep mode
      await new Promise(resolve => setTimeout(resolve, timeoutMs));
      callerRun.process.send({
        type: 'wait_result',
        requestId: msg.requestId,
        completed: {},
        pending: [],
      } as ParentMessage);
      return;
    }

    // Validate ownership: each run must belong to caller (subrun) or a direct child (delegate)
    for (const rid of msg.run_ids) {
      const run = await Run.findByPk(rid);
      if (!run) throw new Error(`Run not found: ${rid}`);
      if (run.agent_id === agentId) {
        // Subrun — must have a parent_run_id (i.e., not a top-level run)
        if (!run.parent_run_id) throw new Error(`Run ${rid} is not a subrun of this agent`);
      } else {
        // Delegate — must belong to a direct child
        const runAgent = run.agent_id ? await Agent.findByPk(run.agent_id) : null;
        if (!runAgent || runAgent.parent_agent_id !== agentId) {
          throw new Error(`Run ${rid} does not belong to a child of this agent`);
        }
      }
    }

    const completed: Record<string, { summary: string; error?: string; hitMaxTurns?: boolean }> = {};
    const pending: string[] = [];

    // Set up a timeout race
    const deadline = Date.now() + timeoutMs;
    const completionPromises: Promise<void>[] = [];

    for (const rid of msg.run_ids) {
      // Check if run is still active in any agent's managed runs
      let isActive = false;
      for (const m of this.agents.values()) {
        if (m.runs.has(rid)) { isActive = true; break; }
      }

      if (!isActive) {
        // Already completed — pull from DB
        const run = await Run.findByPk(rid);
        completed[rid] = {
          summary: run?.run_summary ?? 'Run completed.',
          error: run?.run_error ?? undefined,
        };
      } else {
        // Still running — set up a completion waiter
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          pending.push(rid);
          continue;
        }

        completionPromises.push(
          this.awaitRunCompletion(rid, remaining).then(r => {
            completed[rid] = { summary: r.summary, error: r.error, ...(r.hitMaxTurns ? { hitMaxTurns: true } : {}) };
          }).catch(() => {
            pending.push(rid);
          })
        );

        // Race condition fix: if run completed between isActive check and waiter setup,
        // the waiter would never fire. Re-check and manually notify if needed.
        let stillActive = false;
        for (const m of this.agents.values()) {
          if (m.runs.has(rid)) { stillActive = true; break; }
        }
        if (!stillActive) {
          const run = await Run.findByPk(rid);
          this.notifyRunCompletion(rid, {
            summary: run?.run_summary ?? 'Run completed.',
            error: run?.run_error ?? undefined,
          });
        }
      }
    }

    if (completionPromises.length > 0) {
      await Promise.all(completionPromises);
    }

    callerRun.process.send({
      type: 'wait_result',
      requestId: msg.requestId,
      completed,
      pending,
    } as ParentMessage);
  }

  /** Send a result (success or error) back to the caller that dispatched this run. */
  private routeResultToCaller(
    run: ManagedRun, agentId: string, runId: string,
    summary: string, error?: string, tokens?: any, images?: any, hitMaxTurns?: boolean,
  ): void {
    const resultType = run.callerType === 'subrun' ? 'subrun_result' : 'delegate_result';

    // Find the caller's worker process
    let callerProcess: ChildProcess | undefined;
    if (run.callerType === 'subrun') {
      // Subrun: caller is in the same agent, identified by parentRunId
      const parentRun = this.agents.get(agentId)?.runs.get(run.parentRunId!);
      callerProcess = parentRun?.process;
    } else {
      // Delegate: caller is in a different agent
      const callerManaged = this.agents.get(run.callerAgentId!);
      const callerRun = callerManaged?.runs.get(run.callerRunId!);
      callerProcess = callerRun?.process;
    }

    if (callerProcess) {
      callerProcess.send({
        type: resultType,
        requestId: run.callerRequestId,
        runId,
        summary,
        error,
        ...(run.callerType === 'delegate' ? { tokens, images } : {}),
        ...(hitMaxTurns ? { hitMaxTurns: true } : {}),
      } as ParentMessage);
    }
  }

  /**
   * Notify the source run that dispatched a background child.
   * If the source run is still active, inject a message. If idle, continue the run.
   */
  private notifyCallerOfBackgroundCompletion(
    run: ManagedRun, childAgentId: string, childRunId: string,
    summary: string, error?: string, hitMaxTurns?: boolean,
  ): void {
    const label = run.callerType === 'subrun' ? 'Background subrun' : 'Background delegation';
    const status = error ? `failed: ${error}` : hitMaxTurns ? 'hit max turns (may be incomplete)' : 'completed';
    const message = `[${label} ${childRunId} ${status}]\n${summary}`;

    // Identify the source run that dispatched this background work
    let sourceAgentId: string;
    let sourceRunId: string;
    if (run.callerType === 'subrun') {
      sourceAgentId = childAgentId; // subruns are in the same agent
      sourceRunId = run.parentRunId!;
    } else {
      sourceAgentId = run.callerAgentId!;
      sourceRunId = run.callerRunId!;
    }

    const sourceManaged = this.agents.get(sourceAgentId);
    if (!sourceManaged) return;

    const sourceRun = sourceManaged.runs.get(sourceRunId);
    if (sourceRun) {
      // Source run still active — inject
      sourceRun.process.send({ type: 'inject', message } as ParentMessage);
      this.logger('info', `[${sourceManaged.agent.name}] Background run ${childRunId} completed → injected into run ${sourceRunId}`);
    } else {
      // Source run is idle — continue it with the notification
      this.continueRun(sourceAgentId, sourceRunId, message).catch(err => {
        this.logger('error', `[${sourceManaged.agent.name}] Failed to continue run ${sourceRunId} with background result: ${err.message}`);
      });
      this.logger('info', `[${sourceManaged.agent.name}] Background run ${childRunId} completed → resuming run ${sourceRunId}`);
    }
  }

  private handleChildExit(agentId: string, runId: string, code: number | null): void {
    const managed = this.agents.get(agentId);
    if (!managed) return;

    const exitedRun = managed.runs.get(runId);
    managed.runs.delete(runId);

    // Fallback: route result to caller if run_complete didn't already handle it
    if (exitedRun?.callerRequestId) {
      const errorMsg = code === 0 ? undefined : `${exitedRun.callerType === 'subrun' ? 'Subrun' : 'Delegate'} child exited with code ${code}`;
      this.routeResultToCaller(exitedRun, agentId, runId, '', errorMsg);
    }

    // Cascade kill: stop any child runs whose parent just died
    for (const [childRunId, childRun] of managed.runs) {
      if (childRun.parentRunId === runId) {
        this.stopRun(agentId, childRunId, 'parent run exited').catch(() => {});
      }
    }

    // Mark run as stopped/error if it wasn't already finalized
    if (code !== 0) {
      this.updateRunStatus(agentId, runId, code === null ? 'stopped' : 'error').catch(() => {});
    }

    // Notify any blocking /api/ask waiters (in case child died without run_complete)
    this.notifyRunCompletion(runId, {
      summary: '',
      error: code === 0 ? undefined : `Process exited with code ${code}`,
    });

    // Derive agent status from remaining runs
    this.deriveAgentStatus(agentId).catch(() => {});

    // Schedule idle check — pauses the container if nothing else holds it
    this.scheduleIdleCheck(agentId);
  }

  private async updateRunStatus(agentId: string, runId: string, status: 'running' | 'paused' | 'completed' | 'error' | 'stopped', runError?: string): Promise<void> {
    const update: Record<string, any> = { status };
    if (runError !== undefined) update.run_error = runError;
    await Run.update(update, { where: { id: runId } });
    this.sse.broadcast(agentId, {
      type: 'run_status',
      agentId,
      runId,
      status,
      timestamp: new Date().toISOString(),
    });
  }

  /** Derive agent status from top-level runs (subrun children are internal to their parent) */
  private async deriveAgentStatus(agentId: string): Promise<void> {
    const managed = this.agents.get(agentId);
    if (!managed) return;

    // Only consider top-level runs — subrun children don't affect agent status
    const topLevelRuns = [...managed.runs.values()].filter(r => !r.parentRunId);

    let newStatus: AgentStatus;
    if (topLevelRuns.length === 0) {
      newStatus = managed.runs.size > 0 ? 'running' : 'idle';
    } else {
      let hasRunning = false;
      for (const run of topLevelRuns) {
        if (run.status === 'running') { hasRunning = true; break; }
      }
      newStatus = hasRunning ? 'running' : 'paused';
    }

    if (managed.agent.status !== newStatus) {
      managed.agent.status = newStatus;
      await Agent.update({ status: newStatus }, { where: { id: agentId } });
      this.sse.broadcast(agentId, {
        type: 'agent_status',
        agentId,
        status: newStatus,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // ── SSE Connect ──

  async addSSEClient(agentId: string, res: import('node:http').ServerResponse): Promise<void> {
    this.sse.addClient(agentId, res);

    const managed = this.agents.get(agentId);
    if (managed) {
      res.write(`data: ${JSON.stringify({ type: 'init', agent: managed.agent.toApi() })}\n\n`);
    }

    const logs = await this.getAgentLogs(agentId, 100);
    res.write(`data: ${JSON.stringify({ type: 'history', logs })}\n\n`);

    const latestRun = await Run.findOne({
      where: { agent_id: agentId },
      order: [['created_at', 'DESC']],
    });
    if (latestRun) {
      const messages = await Message.findAll({
        where: { run_id: latestRun.id },
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

  addNotificationClient(res: import('node:http').ServerResponse, userId: string): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    if (!this.notificationClients.has(userId)) {
      this.notificationClients.set(userId, new Set());
    }
    this.notificationClients.get(userId)!.add(res);

    res.write(`data: ${JSON.stringify({ type: 'ready', timestamp: new Date().toISOString() })}\n\n`);

    res.on('close', () => {
      const set = this.notificationClients.get(userId);
      if (set) {
        set.delete(res);
        if (set.size === 0) this.notificationClients.delete(userId);
      }
    });
  }

  private broadcastNotificationToUser(userId: string, data: object): void {
    const set = this.notificationClients.get(userId);
    if (!set) return;
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (const client of set) {
      client.write(payload);
    }
  }

  // ── Queries (for HTTP API) ──

  async getAgentRuns(agentId: string, limit?: number): Promise<any[]> {
    const runs = await Run.findAll({
      where: { agent_id: agentId },
      order: [['created_at', 'DESC']],
      ...(limit ? { limit } : {}),
      include: [{
        model: Message,
        as: 'messages',
        attributes: ['role', 'content'],
        order: [['seq', 'DESC']],
        limit: 1,
        separate: true, // required for limit inside include with hasMany
      }],
    });

    return runs.map(r => r.toApi());
  }

  async getRunMessages(runId: string, afterSeq?: number): Promise<any[]> {
    const where: any = { run_id: runId };
    if (afterSeq != null) {
      where.seq = { [Op.gt]: afterSeq };
    }
    const messages = await Message.findAll({
      where,
      order: [['seq', 'ASC']],
    });
    return messages.map(m => m.toApi());
  }

  async deleteMessage(messageId: string): Promise<boolean> {
    const msg = await Message.findByPk(messageId);
    if (!msg) return false;
    await msg.destroy(); // soft-delete (paranoid)
    return true;
  }

  async getAgentLogs(agentId: string, limit: number = 100): Promise<any[]> {
    const logs = await AgentLog.findAll({
      where: { agent_id: agentId },
      order: [['created_at', 'DESC']],
      limit,
    });
    return logs.map(l => l.toApi());
  }

  // ── File browsing ──

  /** Ensure the agent's container is running and return its container_id. */
  async ensureContainerForBrowsing(agentId: string): Promise<string> {
    const managed = this.agents.get(agentId);
    if (!managed) throw new Error(`Agent not found: ${agentId}`);
    await this.docker.ensureContainer(managed.agent, this.findRootAgentId(agentId));
    // Reset idle timer — container is being actively used
    this.scheduleIdleCheck(agentId);
    return managed.agent.container_id;
  }
}

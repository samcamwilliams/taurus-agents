/**
 * Shared mock setup for daemon tests.
 *
 * Loaded via vitest setupFiles — all vi.mock() calls run before test files.
 * Test files import the exported state (latestFakeChild, mockAgentData, etc.).
 */

import { vi } from 'vitest';
import { EventEmitter } from 'node:events';

// ── Fake ChildProcess ──

export class FakeChildProcess extends EventEmitter {
  killed = false;
  sent: any[] = [];

  send(msg: any) {
    this.sent.push(msg);
    if (msg.type === 'stop') {
      setTimeout(() => this.emitExit(0), 5);
    }
    return true;
  }

  kill(_signal?: string) {
    this.killed = true;
    this.emit('exit', null);
  }

  emitReady() {
    this.emit('message', { type: 'ready' });
  }

  emitPaused(reason = 'test pause') {
    this.emit('message', { type: 'paused', reason });
  }

  emitComplete(summary = 'Done', tokens = { input: 10, output: 5, cost: 0 }) {
    this.emit('message', { type: 'run_complete', summary, tokens });
  }

  emitError(error = 'something broke') {
    this.emit('message', { type: 'error', error });
  }

  emitExit(code: number | null = 0) {
    this.emit('exit', code);
  }
}

// ── Module-level state ──

export let latestFakeChild: FakeChildProcess;

export let runCounter = 0;

// Track created runs so Run.findByPk can resolve them
const createdRuns = new Map<string, any>();

// ── Mock data ──

export const mockAgentData = {
  id: 'agent-1',
  name: 'test-agent',
  status: 'idle',
  system_prompt: 'You are a test agent.',
  tools: ['Bash'],
  cwd: '/workspace',
  model: 'test-model',
  docker_image: 'ubuntu:22.04',
  container_id: 'taurus-agent-test-1',
  schedule: null,
  schedule_overlap: 'skip',
  max_turns: 0,
  timeout_ms: 300000,
  mounts: [],
  folder_id: '00000000-0000-0000-0000-000000000000',
  metadata: null,
  parent_agent_id: null as string | null,
  update: vi.fn(async (data: any) => { Object.assign(mockAgentData, data); }),
  toApi: vi.fn(function (this: any) { return { ...this }; }),
};

export const mockChildAgentData = {
  id: 'agent-child-1',
  name: 'child-agent',
  status: 'idle',
  system_prompt: 'You are a child agent.',
  tools: ['Bash', 'Read'],
  cwd: '/workspace',
  model: 'test-model',
  docker_image: 'ubuntu:22.04',
  container_id: 'taurus-agent-child-1',
  schedule: null,
  schedule_overlap: 'skip',
  max_turns: 0,
  timeout_ms: 300000,
  mounts: [],
  folder_id: '00000000-0000-0000-0000-000000000000',
  metadata: null,
  parent_agent_id: 'agent-1',
  update: vi.fn(async (data: any) => { Object.assign(mockChildAgentData, data); }),
  toApi: vi.fn(function (this: any) { return { ...this }; }),
};

export const allMockAgents: any[] = [mockAgentData, mockChildAgentData];

// ── Register mocks (hoisted by vitest since this is a setupFile) ──

vi.mock('node:child_process', () => ({
  fork: vi.fn(() => {
    latestFakeChild = new FakeChildProcess();
    setTimeout(() => latestFakeChild.emitReady(), 5);
    return latestFakeChild;
  }),
}));

vi.mock('../../src/db/models/Agent.js', () => ({
  default: {
    findAll: vi.fn(async () => allMockAgents),
    findByPk: vi.fn(async (id: string) => allMockAgents.find(a => a.id === id) ?? null),
    create: vi.fn(async (data: any) => {
      const agent = { ...mockAgentData, ...data, toApi: () => ({ ...mockAgentData, ...data }) };
      allMockAgents.push(agent);
      return agent;
    }),
    update: vi.fn(async () => {}),
    destroy: vi.fn(async () => {}),
  },
}));

vi.mock('../../src/db/models/Run.js', () => ({
  default: {
    findAll: vi.fn(async () => []),
    findByPk: vi.fn(async (id: string) => {
      if (createdRuns.has(id)) return createdRuns.get(id);
      return {
        id,
        agent_id: 'agent-1',
        parent_run_id: null,
        status: 'stopped',
        run_summary: 'Completed.',
        run_error: undefined,
        update: vi.fn(async () => {}),
      };
    }),
    findOne: vi.fn(async () => null),
    create: vi.fn(async (data: any) => {
      const run = {
        id: `run-${++runCounter}`,
        ...data,
        status: 'running',
        update: vi.fn(async () => {}),
      };
      createdRuns.set(run.id, run);
      return run;
    }),
    update: vi.fn(async () => {}),
    hasMany: vi.fn(),
  },
}));

vi.mock('../../src/db/models/Message.js', () => ({
  default: {
    findAll: vi.fn(async () => []),
    max: vi.fn(async () => 0),
    create: vi.fn(async () => ({})),
  },
}));

vi.mock('../../src/db/models/AgentLog.js', () => ({
  default: {
    findAll: vi.fn(async () => []),
    create: vi.fn(async () => ({})),
    destroy: vi.fn(async () => {}),
  },
}));

vi.mock('../../src/db/models/Folder.js', () => ({
  default: {
    seedRoot: vi.fn(async () => {}),
  },
}));

vi.mock('../../src/db/models/UserSecret.js', () => ({
  default: {
    getSecrets: vi.fn(async () => ({})),
    getForUser: vi.fn(async () => ({})),
  },
}));

vi.mock('../../src/db/models/User.js', () => ({
  default: {
    findByPk: vi.fn(async () => ({ role: 'admin' })),
  },
}));

vi.mock('../../src/daemon/docker.js', () => ({
  DockerService: class {
    ensureContainer = vi.fn(async () => { await new Promise(r => setTimeout(r, 10)); });
    pauseContainer = vi.fn(async () => {});
    unpauseContainer = vi.fn(async () => {});
    stopContainer = vi.fn(async () => {});
    destroyContainer = vi.fn(async () => {});
    removeContainer = vi.fn(async () => {});
  },
}));

vi.mock('../../src/daemon/sse.js', () => ({
  SSEBroadcaster: class {
    broadcast = vi.fn();
    addClient = vi.fn();
    closeAll = vi.fn();
  },
}));

// ── Helpers ──

const silentLogger = () => {};

export function resetMockState() {
  runCounter = 0;
  createdRuns.clear();
  mockAgentData.status = 'idle';
  mockAgentData.parent_agent_id = null;
  mockChildAgentData.status = 'idle';
}

export async function createTestDaemon(DaemonClass: any): Promise<any> {
  resetMockState();
  const daemon = new DaemonClass(silentLogger);
  await daemon.init();
  return daemon;
}

/**
 * Daemon lifecycle tests — state machine for runs, resume, inject, stop.
 *
 * Mocks: fork(), Docker, DB models. No real containers or LLM calls.
 * Tests the run Map bookkeeping, IPC routing, and status derivation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  FakeChildProcess,
  mockAgentData,
  createTestDaemon,
  resetMockState,
} from './helpers/daemon-mocks.js';

// Re-export latestFakeChild — vi.mock hoists, so we read it from the module
import * as mocks from './helpers/daemon-mocks.js';

// ── Import Daemon after mocks are set up ──

const { Daemon } = await import('../src/daemon/daemon.js');

// ── Tests ──

describe('Daemon run lifecycle', () => {
  let daemon: InstanceType<typeof Daemon>;

  beforeEach(async () => {
    vi.clearAllMocks();
    daemon = await createTestDaemon(Daemon);
  });

  describe('startRun', () => {
    it('forks a worker and adds run to the map', async () => {
      const runId = await daemon.startRun('agent-1', 'manual', 'hello');

      expect(runId).toBe('run-1');
      expect(daemon.hasActiveRuns('agent-1')).toBe(true);
      expect(daemon.isRunning('agent-1')).toBe(true);

      // Worker received the start message
      expect(mocks.latestFakeChild.sent).toHaveLength(1);
      expect(mocks.latestFakeChild.sent[0].type).toBe('start');
      expect(mocks.latestFakeChild.sent[0].input).toBe('hello');
      expect(mocks.latestFakeChild.sent[0].resume).toBeFalsy();
    });
  });

  describe('continueRun — paused worker alive', () => {
    it('sends IPC resume without forking a new worker', async () => {
      const runId = await daemon.startRun('agent-1', 'manual', 'hello');
      const worker = mocks.latestFakeChild;
      worker.emitPaused('waiting for input');

      const activeRun = daemon.getActiveRun('agent-1', runId);
      expect(activeRun?.status).toBe('paused');

      const sentBefore = worker.sent.length;
      await daemon.continueRun('agent-1', runId, 'continue please');

      expect(worker.sent.length).toBe(sentBefore + 1);
      const resumeMsg = worker.sent[worker.sent.length - 1];
      expect(resumeMsg.type).toBe('resume');
      expect(resumeMsg.message).toBe('continue please');
      expect(activeRun?.status).toBe('running');
    });
  });

  describe('continueRun — worker dead (DB replay)', () => {
    it('forks a new worker with resume=true', async () => {
      const runId = await daemon.startRun('agent-1', 'manual', 'hello');
      const oldWorker = mocks.latestFakeChild;
      oldWorker.emitComplete();
      oldWorker.emitExit(0);

      expect(daemon.hasActiveRuns('agent-1')).toBe(false);

      await daemon.continueRun('agent-1', runId, 'pick up where we left off');

      expect(mocks.latestFakeChild).not.toBe(oldWorker);
      expect(mocks.latestFakeChild.sent[0].type).toBe('start');
      expect(mocks.latestFakeChild.sent[0].resume).toBe(true);
      expect(mocks.latestFakeChild.sent[0].input).toBe('pick up where we left off');
      expect(daemon.hasActiveRuns('agent-1')).toBe(true);
    });
  });

  describe('continueRun — already running', () => {
    it('throws if the run is already running', async () => {
      const runId = await daemon.startRun('agent-1', 'manual', 'hello');

      await expect(
        daemon.continueRun('agent-1', runId, 'again')
      ).rejects.toThrow(/already running/);
    });
  });

  describe('stopRun', () => {
    it('sends stop IPC and removes run from map on exit', async () => {
      const runId = await daemon.startRun('agent-1', 'manual', 'hello');
      const worker = mocks.latestFakeChild;

      await daemon.stopRun('agent-1', runId, 'user stop');

      const stopMsg = worker.sent.find((m: any) => m.type === 'stop');
      expect(stopMsg).toBeDefined();
      expect(stopMsg.reason).toBe('user stop');
      expect(daemon.hasActiveRuns('agent-1')).toBe(false);
    });
  });

  describe('stopAllRuns', () => {
    it('stops all active runs for an agent', async () => {
      await daemon.startRun('agent-1', 'manual', 'run 1');
      await daemon.stopAllRuns('agent-1', 'cleanup');
      expect(daemon.hasActiveRuns('agent-1')).toBe(false);
    });
  });

  describe('injectMessage', () => {
    it('sends inject IPC to a running worker', async () => {
      await daemon.startRun('agent-1', 'manual', 'hello');
      const worker = mocks.latestFakeChild;
      const sentBefore = worker.sent.length;

      await daemon.injectMessage('agent-1', 'do this too');

      const injectMsg = worker.sent[worker.sent.length - 1];
      expect(injectMsg.type).toBe('inject');
      expect(injectMsg.message).toBe('do this too');
    });

    it('resumes a paused worker when injecting', async () => {
      const runId = await daemon.startRun('agent-1', 'manual', 'hello');
      const worker = mocks.latestFakeChild;
      worker.emitPaused('waiting');

      await daemon.injectMessage('agent-1', 'here is your answer');

      const lastMsg = worker.sent[worker.sent.length - 1];
      expect(lastMsg.type).toBe('resume');
      expect(lastMsg.message).toBe('here is your answer');
    });

    it('throws when no active run exists', async () => {
      await expect(
        daemon.injectMessage('agent-1', 'hello')
      ).rejects.toThrow(/No active run/);
    });
  });

  describe('agent status derivation', () => {
    it('is idle when no runs active', async () => {
      expect(mockAgentData.status).toBe('idle');
    });

    it('is running when a run is active', async () => {
      await daemon.startRun('agent-1', 'manual', 'hello');
      expect(mockAgentData.status).toBe('running');
    });

    it('is paused when all runs are paused', async () => {
      await daemon.startRun('agent-1', 'manual', 'hello');
      mocks.latestFakeChild.emitPaused('thinking');
      await new Promise(r => setTimeout(r, 10));
      expect(mockAgentData.status).toBe('paused');
    });

    it('returns to idle after run completes', async () => {
      await daemon.startRun('agent-1', 'manual', 'hello');
      mocks.latestFakeChild.emitComplete();
      mocks.latestFakeChild.emitExit(0);
      await new Promise(r => setTimeout(r, 10));
      expect(mockAgentData.status).toBe('idle');
      expect(daemon.hasActiveRuns('agent-1')).toBe(false);
    });
  });

  describe('container pause on last run exit', () => {
    it('schedules idle timer when the last run exits', async () => {
      await daemon.startRun('agent-1', 'manual', 'hello');

      mocks.latestFakeChild.emitComplete();
      mocks.latestFakeChild.emitExit(0);
      await new Promise(r => setTimeout(r, 10));

      const managed = (daemon as any).agents.get('agent-1');
      expect(managed.idleTimer).toBeDefined();
    });
  });

  describe('getCurrentRunId', () => {
    it('returns running run ID', async () => {
      const runId = await daemon.startRun('agent-1', 'manual', 'hello');
      expect(daemon.getCurrentRunId('agent-1')).toBe(runId);
    });

    it('returns null when no runs active', () => {
      expect(daemon.getCurrentRunId('agent-1')).toBeNull();
    });

    it('returns paused run ID when only paused runs', async () => {
      const runId = await daemon.startRun('agent-1', 'manual', 'hello');
      mocks.latestFakeChild.emitPaused('waiting');
      await new Promise(r => setTimeout(r, 10));
      expect(daemon.getCurrentRunId('agent-1')).toBe(runId);
    });
  });

  describe('awaitRunCompletion', () => {
    it('resolves when run completes', async () => {
      const runId = await daemon.startRun('agent-1', 'manual', 'hello');
      const completion = daemon.awaitRunCompletion(runId, 5000);

      mocks.latestFakeChild.emitComplete('all done', { input: 100, output: 50, cost: 0 });
      mocks.latestFakeChild.emitExit(0);

      const result = await completion;
      expect(result.summary).toBe('all done');
      expect(result.tokens?.input).toBe(100);
    });

    it('resolves with error when worker crashes', async () => {
      const runId = await daemon.startRun('agent-1', 'manual', 'hello');
      const completion = daemon.awaitRunCompletion(runId, 5000);

      mocks.latestFakeChild.emitExit(1);

      const result = await completion;
      expect(result.error).toContain('exited with code 1');
    });
  });
});

/**
 * Subrun IPC tests — child run forking, result routing, background dispatch, resume.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  mockAgentData,
  createTestDaemon,
} from './helpers/daemon-mocks.js';

import * as mocks from './helpers/daemon-mocks.js';

const { Daemon } = await import('../src/daemon/daemon.js');

describe('Subrun', () => {
  let daemon: InstanceType<typeof Daemon>;

  beforeEach(async () => {
    vi.clearAllMocks();
    daemon = await createTestDaemon(Daemon);
  });

  it('creates a child run when parent sends a subrun request', async () => {
    await daemon.startRun('agent-1', 'manual', 'hello');
    const parentWorker = mocks.latestFakeChild;

    parentWorker.emit('message', {
      type: 'subrun_request',
      requestId: 'req-1',
      input: 'do subtask',
    });
    await new Promise(r => setTimeout(r, 50));

    const childWorker = mocks.latestFakeChild;
    expect(childWorker).not.toBe(parentWorker);
    expect(childWorker.sent[0].type).toBe('start');
    expect(childWorker.sent[0].input).toBe('do subtask');
    expect(daemon.hasActiveRuns('agent-1')).toBe(true);
  });

  it('routes subrun result back to parent when child completes', async () => {
    await daemon.startRun('agent-1', 'manual', 'hello');
    const parentWorker = mocks.latestFakeChild;

    parentWorker.emit('message', {
      type: 'subrun_request',
      requestId: 'req-1',
      input: 'do subtask',
    });
    await new Promise(r => setTimeout(r, 50));

    const childWorker = mocks.latestFakeChild;
    childWorker.emitComplete('subtask done', { input: 20, output: 10, cost: 0 });
    childWorker.emitExit(0);
    await new Promise(r => setTimeout(r, 20));

    const subrunResult = parentWorker.sent.find((m: any) => m.type === 'subrun_result');
    expect(subrunResult).toBeDefined();
    expect(subrunResult.requestId).toBe('req-1');
    expect(subrunResult.summary).toBe('subtask done');
    expect(subrunResult.runId).toBeDefined();
    expect(subrunResult.error).toBeUndefined();
  });

  it('routes subrun error back to parent when child sends error IPC', async () => {
    await daemon.startRun('agent-1', 'manual', 'hello');
    const parentWorker = mocks.latestFakeChild;

    parentWorker.emit('message', {
      type: 'subrun_request',
      requestId: 'req-err',
      input: 'do failing subtask',
    });
    await new Promise(r => setTimeout(r, 50));

    const childWorker = mocks.latestFakeChild;
    childWorker.emitError('agent threw an exception');
    await new Promise(r => setTimeout(r, 20));

    const subrunResult = parentWorker.sent.find((m: any) => m.type === 'subrun_result');
    expect(subrunResult).toBeDefined();
    expect(subrunResult.requestId).toBe('req-err');
    expect(subrunResult.error).toBe('agent threw an exception');
  });

  it('routes subrun error back to parent when child crashes', async () => {
    await daemon.startRun('agent-1', 'manual', 'hello');
    const parentWorker = mocks.latestFakeChild;

    parentWorker.emit('message', {
      type: 'subrun_request',
      requestId: 'req-2',
      input: 'do risky subtask',
    });
    await new Promise(r => setTimeout(r, 50));

    const childWorker = mocks.latestFakeChild;
    childWorker.emitExit(1);
    await new Promise(r => setTimeout(r, 20));

    const subrunResult = parentWorker.sent.find((m: any) => m.type === 'subrun_result');
    expect(subrunResult).toBeDefined();
    expect(subrunResult.requestId).toBe('req-2');
    expect(subrunResult.error).toContain('exited with code 1');
  });

  it('passes only subset tools to child (intersection with parent)', async () => {
    await daemon.startRun('agent-1', 'manual', 'hello');
    const parentWorker = mocks.latestFakeChild;

    parentWorker.emit('message', {
      type: 'subrun_request',
      requestId: 'req-tools',
      input: 'do subtask',
      tools: ['Bash', 'Read', 'WebSearch'],
    });
    await new Promise(r => setTimeout(r, 50));

    const childWorker = mocks.latestFakeChild;
    const startMsg = childWorker.sent[0];
    expect(startMsg.type).toBe('start');
    // Only 'Bash' survives — Read and WebSearch are not in parent's ['Bash']
    expect(startMsg.tools).toEqual(['Bash']);
  });

  it('inherits parent tools when no tools specified in subrun', async () => {
    await daemon.startRun('agent-1', 'manual', 'hello');
    const parentWorker = mocks.latestFakeChild;

    parentWorker.emit('message', {
      type: 'subrun_request',
      requestId: 'req-no-tools',
      input: 'do subtask',
    });
    await new Promise(r => setTimeout(r, 50));

    const childWorker = mocks.latestFakeChild;
    const startMsg = childWorker.sent[0];
    expect(startMsg.type).toBe('start');
    expect(startMsg.tools).toBeUndefined();
  });

  it('cascade kills child runs when parent exits', async () => {
    await daemon.startRun('agent-1', 'manual', 'hello');
    const parentWorker = mocks.latestFakeChild;

    parentWorker.emit('message', {
      type: 'subrun_request',
      requestId: 'req-3',
      input: 'long subtask',
    });
    await new Promise(r => setTimeout(r, 50));

    const childWorker = mocks.latestFakeChild;
    expect(childWorker.killed).toBe(false);

    parentWorker.emitExit(0);
    await new Promise(r => setTimeout(r, 50));

    const stopMsg = childWorker.sent.find((m: any) => m.type === 'stop');
    expect(stopMsg).toBeDefined();
    expect(stopMsg.reason).toBe('parent run exited');
  });

  // ── Background dispatch ──

  it('returns immediately with run_id when background=true', async () => {
    await daemon.startRun('agent-1', 'manual', 'hello');
    const parentWorker = mocks.latestFakeChild;

    parentWorker.emit('message', {
      type: 'subrun_request',
      requestId: 'req-bg',
      input: 'background task',
      background: true,
    });
    await new Promise(r => setTimeout(r, 50));

    // Parent should have received an immediate subrun_result with empty summary
    const subrunResult = parentWorker.sent.find((m: any) => m.type === 'subrun_result');
    expect(subrunResult).toBeDefined();
    expect(subrunResult.requestId).toBe('req-bg');
    expect(subrunResult.summary).toBe('');
    expect(subrunResult.runId).toBeDefined();

    // The child worker should still be running (not completed yet)
    const childWorker = mocks.latestFakeChild;
    expect(childWorker).not.toBe(parentWorker);
    expect(childWorker.sent[0].type).toBe('start');
  });

  it('does not route result back to parent when background child completes', async () => {
    await daemon.startRun('agent-1', 'manual', 'hello');
    const parentWorker = mocks.latestFakeChild;

    parentWorker.emit('message', {
      type: 'subrun_request',
      requestId: 'req-bg-complete',
      input: 'bg task',
      background: true,
    });
    await new Promise(r => setTimeout(r, 50));

    const childWorker = mocks.latestFakeChild;

    // Clear the immediate background result from parent's sent
    const bgResultIdx = parentWorker.sent.findIndex((m: any) => m.type === 'subrun_result');
    expect(bgResultIdx).toBeGreaterThanOrEqual(0);

    // Now child completes — should NOT send a second subrun_result to parent
    childWorker.emitComplete('bg done');
    childWorker.emitExit(0);
    await new Promise(r => setTimeout(r, 20));

    const allSubrunResults = parentWorker.sent.filter((m: any) => m.type === 'subrun_result');
    expect(allSubrunResults).toHaveLength(1); // Only the immediate one
  });

  // ── Resume with run_id ──

  it('resumes a previous subrun by run_id', async () => {
    await daemon.startRun('agent-1', 'manual', 'hello');
    const parentWorker = mocks.latestFakeChild;

    // Start a subrun and let it complete
    parentWorker.emit('message', {
      type: 'subrun_request',
      requestId: 'req-first',
      input: 'first task',
    });
    await new Promise(r => setTimeout(r, 50));

    const firstChild = mocks.latestFakeChild;
    const firstStartMsg = firstChild.sent[0];
    const firstRunId = firstStartMsg.runId;

    firstChild.emitComplete('first done');
    firstChild.emitExit(0);
    await new Promise(r => setTimeout(r, 20));

    // Now resume that same run
    parentWorker.emit('message', {
      type: 'subrun_request',
      requestId: 'req-resume',
      input: 'continue from where you left off',
      run_id: firstRunId,
    });
    await new Promise(r => setTimeout(r, 50));

    const resumedChild = mocks.latestFakeChild;
    expect(resumedChild).not.toBe(firstChild);
    expect(resumedChild.sent[0].type).toBe('start');
    expect(resumedChild.sent[0].resume).toBe(true);
    expect(resumedChild.sent[0].runId).toBe(firstRunId);
    expect(resumedChild.sent[0].input).toBe('continue from where you left off');
  });
});

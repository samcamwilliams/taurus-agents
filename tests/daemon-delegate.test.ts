/**
 * Delegate IPC tests — cross-agent dispatch, background mode, resume.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  mockChildAgentData,
  createTestDaemon,
} from './helpers/daemon-mocks.js';

import * as mocks from './helpers/daemon-mocks.js';

const { Daemon } = await import('../src/daemon/daemon.js');

describe('Delegate', () => {
  let daemon: InstanceType<typeof Daemon>;

  beforeEach(async () => {
    vi.clearAllMocks();
    daemon = await createTestDaemon(Daemon);
  });

  it('delegates a task to a child agent', async () => {
    await daemon.startRun('agent-1', 'manual', 'hello');
    const parentWorker = mocks.latestFakeChild;

    parentWorker.emit('message', {
      type: 'delegate_request',
      requestId: 'del-1',
      targetAgent: 'child-agent',
      input: 'do research',
    });
    await new Promise(r => setTimeout(r, 50));

    // A worker was forked for the child agent
    const childWorker = mocks.latestFakeChild;
    expect(childWorker).not.toBe(parentWorker);
    expect(childWorker.sent[0].type).toBe('start');
    expect(childWorker.sent[0].input).toBe('do research');
    expect(childWorker.sent[0].trigger).toBe('delegate');
  });

  it('routes delegate result back to parent when child completes', async () => {
    await daemon.startRun('agent-1', 'manual', 'hello');
    const parentWorker = mocks.latestFakeChild;

    parentWorker.emit('message', {
      type: 'delegate_request',
      requestId: 'del-2',
      targetAgent: 'child-agent',
      input: 'do research',
    });
    await new Promise(r => setTimeout(r, 50));

    const childWorker = mocks.latestFakeChild;
    childWorker.emitComplete('research done', { input: 50, output: 25, cost: 0 });
    childWorker.emitExit(0);
    await new Promise(r => setTimeout(r, 20));

    const delegateResult = parentWorker.sent.find((m: any) => m.type === 'delegate_result');
    expect(delegateResult).toBeDefined();
    expect(delegateResult.requestId).toBe('del-2');
    expect(delegateResult.summary).toBe('research done');
    expect(delegateResult.runId).toBeDefined();
  });

  it('rejects delegate to unknown child', async () => {
    await daemon.startRun('agent-1', 'manual', 'hello');
    const parentWorker = mocks.latestFakeChild;

    // Emit delegate to a non-existent child — the daemon catches the error
    parentWorker.emit('message', {
      type: 'delegate_request',
      requestId: 'del-bad',
      targetAgent: 'nonexistent-agent',
      input: 'should fail',
    });
    await new Promise(r => setTimeout(r, 50));

    // Parent should get a delegate_result with an error
    const delegateResult = parentWorker.sent.find((m: any) => m.type === 'delegate_result');
    expect(delegateResult).toBeDefined();
    expect(delegateResult.error).toContain('not a child');
  });

  // ── Background dispatch ──

  it('returns immediately with run_id when background=true', async () => {
    await daemon.startRun('agent-1', 'manual', 'hello');
    const parentWorker = mocks.latestFakeChild;

    parentWorker.emit('message', {
      type: 'delegate_request',
      requestId: 'del-bg',
      targetAgent: 'child-agent',
      input: 'background research',
      background: true,
    });
    await new Promise(r => setTimeout(r, 50));

    // Parent should have received an immediate delegate_result
    const delegateResult = parentWorker.sent.find((m: any) => m.type === 'delegate_result');
    expect(delegateResult).toBeDefined();
    expect(delegateResult.requestId).toBe('del-bg');
    expect(delegateResult.summary).toBe('');
    expect(delegateResult.runId).toBeDefined();

    // Child is still running
    const childWorker = mocks.latestFakeChild;
    expect(childWorker).not.toBe(parentWorker);
  });

  it('does not send a second result when background child completes', async () => {
    await daemon.startRun('agent-1', 'manual', 'hello');
    const parentWorker = mocks.latestFakeChild;

    parentWorker.emit('message', {
      type: 'delegate_request',
      requestId: 'del-bg-2',
      targetAgent: 'child-agent',
      input: 'bg work',
      background: true,
    });
    await new Promise(r => setTimeout(r, 50));

    const childWorker = mocks.latestFakeChild;
    childWorker.emitComplete('bg done');
    childWorker.emitExit(0);
    await new Promise(r => setTimeout(r, 20));

    const allResults = parentWorker.sent.filter((m: any) => m.type === 'delegate_result');
    expect(allResults).toHaveLength(1); // Only the immediate background result
  });

  // ── Resume with run_id ──

  it('resumes a specific child run by run_id', async () => {
    await daemon.startRun('agent-1', 'manual', 'hello');
    const parentWorker = mocks.latestFakeChild;

    // First delegate — let child complete
    parentWorker.emit('message', {
      type: 'delegate_request',
      requestId: 'del-first',
      targetAgent: 'child-agent',
      input: 'initial task',
    });
    await new Promise(r => setTimeout(r, 50));

    const firstChild = mocks.latestFakeChild;
    firstChild.emitComplete('initial done');
    firstChild.emitExit(0);
    await new Promise(r => setTimeout(r, 20));

    // Get the run ID from the result
    const firstResult = parentWorker.sent.find((m: any) => m.type === 'delegate_result');
    const childRunId = firstResult.runId;

    // Now resume with that run_id
    parentWorker.emit('message', {
      type: 'delegate_request',
      requestId: 'del-resume',
      targetAgent: 'child-agent',
      input: 'continue your research',
      run_id: childRunId,
    });
    await new Promise(r => setTimeout(r, 50));

    const resumedChild = mocks.latestFakeChild;
    expect(resumedChild).not.toBe(firstChild);
    expect(resumedChild.sent[0].type).toBe('start');
    expect(resumedChild.sent[0].resume).toBe(true);
    expect(resumedChild.sent[0].runId).toBe(childRunId);
  });
});

/**
 * Wait IPC tests — waiting for background runs, sleep mode, timeout.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createTestDaemon,
} from './helpers/daemon-mocks.js';

import * as mocks from './helpers/daemon-mocks.js';

const { Daemon } = await import('../src/daemon/daemon.js');

describe('Wait', () => {
  let daemon: InstanceType<typeof Daemon>;

  beforeEach(async () => {
    vi.clearAllMocks();
    daemon = await createTestDaemon(Daemon);
  });

  it('waits for a background subrun to complete', async () => {
    await daemon.startRun('agent-1', 'manual', 'hello');
    const parentWorker = mocks.latestFakeChild;

    // Launch a background subrun
    parentWorker.emit('message', {
      type: 'subrun_request',
      requestId: 'bg-1',
      input: 'background work',
      background: true,
    });
    await new Promise(r => setTimeout(r, 50));

    const bgResult = parentWorker.sent.find((m: any) => m.type === 'subrun_result');
    const bgRunId = bgResult.runId;
    const childWorker = mocks.latestFakeChild;

    // Now send wait_request for that run
    parentWorker.emit('message', {
      type: 'wait_request',
      requestId: 'wait-1',
      run_ids: [bgRunId],
      timeout_ms: 5000,
    });

    // Let the wait handler set up, then complete the child
    await new Promise(r => setTimeout(r, 20));
    childWorker.emitComplete('bg completed', { input: 30, output: 15, cost: 0 });
    childWorker.emitExit(0);
    await new Promise(r => setTimeout(r, 50));

    const waitResult = parentWorker.sent.find((m: any) => m.type === 'wait_result');
    expect(waitResult).toBeDefined();
    expect(waitResult.requestId).toBe('wait-1');
    expect(waitResult.completed[bgRunId]).toBeDefined();
    expect(waitResult.completed[bgRunId].summary).toBe('bg completed');
    expect(waitResult.pending).toHaveLength(0);
  });

  it('returns already-completed runs immediately', async () => {
    await daemon.startRun('agent-1', 'manual', 'hello');
    const parentWorker = mocks.latestFakeChild;

    // Launch a background subrun and let it complete
    parentWorker.emit('message', {
      type: 'subrun_request',
      requestId: 'bg-done',
      input: 'quick task',
      background: true,
    });
    await new Promise(r => setTimeout(r, 50));

    const bgResult = parentWorker.sent.find((m: any) => m.type === 'subrun_result');
    const bgRunId = bgResult.runId;
    const childWorker = mocks.latestFakeChild;

    childWorker.emitComplete('already done');
    childWorker.emitExit(0);
    await new Promise(r => setTimeout(r, 20));

    // Now wait for the already-completed run
    parentWorker.emit('message', {
      type: 'wait_request',
      requestId: 'wait-done',
      run_ids: [bgRunId],
      timeout_ms: 5000,
    });
    await new Promise(r => setTimeout(r, 50));

    const waitResult = parentWorker.sent.find((m: any) => m.type === 'wait_result');
    expect(waitResult).toBeDefined();
    expect(waitResult.completed[bgRunId]).toBeDefined();
    expect(waitResult.pending).toHaveLength(0);
  });

  it('acts as a pure sleep when no run_ids provided', async () => {
    await daemon.startRun('agent-1', 'manual', 'hello');
    const parentWorker = mocks.latestFakeChild;

    parentWorker.emit('message', {
      type: 'wait_request',
      requestId: 'wait-sleep',
      timeout_ms: 50, // Short sleep for testing
    });

    // Should resolve after the timeout
    await new Promise(r => setTimeout(r, 100));

    const waitResult = parentWorker.sent.find((m: any) => m.type === 'wait_result');
    expect(waitResult).toBeDefined();
    expect(waitResult.requestId).toBe('wait-sleep');
    expect(waitResult.completed).toEqual({});
    expect(waitResult.pending).toEqual([]);
  });

  it('waits for a background delegate to complete', async () => {
    await daemon.startRun('agent-1', 'manual', 'hello');
    const parentWorker = mocks.latestFakeChild;

    // Launch a background delegate
    parentWorker.emit('message', {
      type: 'delegate_request',
      requestId: 'del-bg',
      targetAgent: 'child-agent',
      input: 'research in background',
      background: true,
    });
    await new Promise(r => setTimeout(r, 50));

    const delResult = parentWorker.sent.find((m: any) => m.type === 'delegate_result');
    const delRunId = delResult.runId;
    const childWorker = mocks.latestFakeChild;

    // Wait for it
    parentWorker.emit('message', {
      type: 'wait_request',
      requestId: 'wait-del',
      run_ids: [delRunId],
      timeout_ms: 5000,
    });
    await new Promise(r => setTimeout(r, 20));

    childWorker.emitComplete('research done');
    childWorker.emitExit(0);
    await new Promise(r => setTimeout(r, 50));

    const waitResult = parentWorker.sent.find((m: any) => m.type === 'wait_result');
    expect(waitResult).toBeDefined();
    expect(waitResult.completed[delRunId]).toBeDefined();
    expect(waitResult.completed[delRunId].summary).toBe('research done');
    expect(waitResult.pending).toHaveLength(0);
  });
});

/**
 * Inspect IPC tests — self-inspection and child inspection of run history.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  mockAgentData,
  mockChildAgentData,
  createTestDaemon,
} from '../helpers/daemon-mocks.js';

import * as mocks from '../helpers/daemon-mocks.js';

const { Daemon } = await import('../../src/daemon/daemon.js');

describe('Inspect', () => {
  let daemon: InstanceType<typeof Daemon>;

  beforeEach(async () => {
    vi.clearAllMocks();
    daemon = await createTestDaemon(Daemon);
  });

  it('self-inspection: lists own runs (empty when no history)', async () => {
    await daemon.startRun('agent-1', 'manual', 'hello');
    const worker = mocks.latestFakeChild;

    worker.emit('message', {
      type: 'inspect_request',
      requestId: 'insp-1',
    });
    await new Promise(r => setTimeout(r, 50));

    const result = worker.sent.find((m: any) => m.type === 'inspect_result');
    expect(result).toBeDefined();
    expect(result.requestId).toBe('insp-1');
    expect(result.error).toBeUndefined();
    // Mock DB returns empty findAll, so we get no runs
    expect(result.result).toBeDefined();
  });

  it('self-inspection with agent="self" is equivalent to no agent', async () => {
    await daemon.startRun('agent-1', 'manual', 'hello');
    const worker = mocks.latestFakeChild;

    worker.emit('message', {
      type: 'inspect_request',
      requestId: 'insp-self',
      agent: 'self',
    });
    await new Promise(r => setTimeout(r, 50));

    const result = worker.sent.find((m: any) => m.type === 'inspect_result');
    expect(result).toBeDefined();
    expect(result.error).toBeUndefined();
  });

  it('child inspection: resolves child agent by name', async () => {
    await daemon.startRun('agent-1', 'manual', 'hello');
    const worker = mocks.latestFakeChild;

    worker.emit('message', {
      type: 'inspect_request',
      requestId: 'insp-child',
      agent: 'child-agent',
    });
    await new Promise(r => setTimeout(r, 50));

    const result = worker.sent.find((m: any) => m.type === 'inspect_result');
    expect(result).toBeDefined();
    expect(result.error).toBeUndefined();
  });

  it('rejects inspection of unknown child', async () => {
    await daemon.startRun('agent-1', 'manual', 'hello');
    const worker = mocks.latestFakeChild;

    worker.emit('message', {
      type: 'inspect_request',
      requestId: 'insp-bad',
      agent: 'nonexistent-agent',
    });
    await new Promise(r => setTimeout(r, 50));

    const result = worker.sent.find((m: any) => m.type === 'inspect_result');
    expect(result).toBeDefined();
    expect(result.error).toContain('not found');
  });
});

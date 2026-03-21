/**
 * Pause routing tests — universal Pause with context-aware routing.
 *
 * Top-level agents: pause broadcasts SSE to human.
 * Child agents (subrun/delegate): pause routes to parent run.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  mockAgentData,
  mockChildAgentData,
  createTestDaemon,
} from '../helpers/daemon-mocks.js';

import * as mocks from '../helpers/daemon-mocks.js';

const { Daemon } = await import('../../src/daemon/daemon.js');

describe('Pause routing', () => {
  let daemon: InstanceType<typeof Daemon>;

  beforeEach(async () => {
    vi.clearAllMocks();
    daemon = await createTestDaemon(Daemon);
  });

  it('top-level pause broadcasts SSE event', async () => {
    await daemon.startRun('agent-1', 'manual', 'hello');
    const worker = mocks.latestFakeChild;

    worker.emit('message', {
      type: 'paused',
      reason: 'Need human approval',
    });
    await new Promise(r => setTimeout(r, 50));

    // SSE should have been called with agent_paused
    const sse = (daemon as any).sse;
    const pausedBroadcast = sse.broadcast.mock.calls.find(
      (call: any[]) => call[1]?.type === 'agent_paused',
    );
    expect(pausedBroadcast).toBeDefined();
    expect(pausedBroadcast[1].reason).toBe('Need human approval');
  });

  it('subrun child pause routes message to parent run', async () => {
    await daemon.startRun('agent-1', 'manual', 'hello');
    const parentWorker = mocks.latestFakeChild;

    // Start a subrun
    parentWorker.emit('message', {
      type: 'subrun_request',
      requestId: 'req-sub',
      input: 'do work',
    });
    await new Promise(r => setTimeout(r, 50));

    const childWorker = mocks.latestFakeChild;
    expect(childWorker).not.toBe(parentWorker);

    // Child pauses
    childWorker.emit('message', {
      type: 'paused',
      reason: 'Need clarification on requirements',
    });
    await new Promise(r => setTimeout(r, 50));

    // Parent should receive an inject with <child-paused> envelope
    const injectMsg = parentWorker.sent.find((m: any) => m.type === 'inject');
    expect(injectMsg).toBeDefined();
    expect(injectMsg.message).toContain('<child-paused');
    expect(injectMsg.message).toContain('Need clarification on requirements');
    expect(injectMsg.message).toContain('</child-paused>');
    expect(injectMsg.message).toContain(mockAgentData.name);
  });

  it('delegate child pause routes message to parent agent', async () => {
    await daemon.startRun('agent-1', 'manual', 'hello');
    const parentWorker = mocks.latestFakeChild;

    // Delegate to child agent
    parentWorker.emit('message', {
      type: 'delegate_request',
      requestId: 'del-1',
      targetAgent: 'child-agent',
      input: 'research topic',
    });
    await new Promise(r => setTimeout(r, 50));

    const childWorker = mocks.latestFakeChild;
    expect(childWorker).not.toBe(parentWorker);

    // Child agent pauses
    childWorker.emit('message', {
      type: 'paused',
      reason: 'Cannot find source material',
    });
    await new Promise(r => setTimeout(r, 50));

    // Parent should receive an inject with <child-paused> envelope
    const injectMsg = parentWorker.sent.find((m: any) => m.type === 'inject');
    expect(injectMsg).toBeDefined();
    expect(injectMsg.message).toContain('<child-paused');
    expect(injectMsg.message).toContain('Cannot find source material');
    expect(injectMsg.message).toContain(mockChildAgentData.name);

    // Should include messageMeta with author info
    expect(injectMsg.messageMeta).toBeDefined();
    expect(injectMsg.messageMeta.author.label).toBe(mockChildAgentData.name);
  });

  it('child pause does NOT broadcast SSE agent_paused', async () => {
    await daemon.startRun('agent-1', 'manual', 'hello');
    const parentWorker = mocks.latestFakeChild;

    parentWorker.emit('message', {
      type: 'subrun_request',
      requestId: 'req-sub',
      input: 'do work',
    });
    await new Promise(r => setTimeout(r, 50));

    const childWorker = mocks.latestFakeChild;

    // Clear any SSE broadcasts from setup
    const sse = (daemon as any).sse;
    sse.broadcast.mockClear();

    childWorker.emit('message', {
      type: 'paused',
      reason: 'Question for parent',
    });
    await new Promise(r => setTimeout(r, 50));

    // Should NOT have an agent_paused SSE broadcast (it went to parent instead)
    const pausedBroadcast = sse.broadcast.mock.calls.find(
      (call: any[]) => call[1]?.type === 'agent_paused',
    );
    expect(pausedBroadcast).toBeUndefined();
  });
});

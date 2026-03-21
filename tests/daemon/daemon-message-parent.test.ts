/**
 * MessageParent IPC tests — child-to-parent message routing for subruns and delegates.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  mockAgentData,
  mockChildAgentData,
  createTestDaemon,
} from '../helpers/daemon-mocks.js';

import * as mocks from '../helpers/daemon-mocks.js';

const { Daemon } = await import('../../src/daemon/daemon.js');

describe('MessageParent', () => {
  let daemon: InstanceType<typeof Daemon>;

  beforeEach(async () => {
    vi.clearAllMocks();
    daemon = await createTestDaemon(Daemon);
  });

  it('routes message from subrun child to parent via inject IPC', async () => {
    await daemon.startRun('agent-1', 'manual', 'hello');
    const parentWorker = mocks.latestFakeChild;

    // Start a subrun
    parentWorker.emit('message', {
      type: 'subrun_request',
      requestId: 'req-sub',
      input: 'do subtask',
    });
    await new Promise(r => setTimeout(r, 50));

    const childWorker = mocks.latestFakeChild;
    expect(childWorker).not.toBe(parentWorker);

    // Child sends a message_parent_request
    childWorker.emit('message', {
      type: 'message_parent_request',
      requestId: 'mp-1',
      message: 'Found something interesting',
    });
    await new Promise(r => setTimeout(r, 50));

    // Parent should have received an inject IPC with the message
    const injectMsg = parentWorker.sent.find((m: any) => m.type === 'inject');
    expect(injectMsg).toBeDefined();
    expect(injectMsg.message).toBe('Found something interesting');

    // Inject should carry messageMeta with author info
    expect(injectMsg.messageMeta).toBeDefined();
    expect(injectMsg.messageMeta.author).toBeDefined();
    expect(injectMsg.messageMeta.author.kind).toBe('agent');
    expect(injectMsg.messageMeta.author.agentId).toBe('agent-1');
    expect(injectMsg.messageMeta.author.label).toBe(mockAgentData.name);
  });

  it('sends message_parent_result back to the child', async () => {
    await daemon.startRun('agent-1', 'manual', 'hello');
    const parentWorker = mocks.latestFakeChild;

    parentWorker.emit('message', {
      type: 'subrun_request',
      requestId: 'req-sub',
      input: 'do subtask',
    });
    await new Promise(r => setTimeout(r, 50));

    const childWorker = mocks.latestFakeChild;

    childWorker.emit('message', {
      type: 'message_parent_request',
      requestId: 'mp-2',
      message: 'Status update',
    });
    await new Promise(r => setTimeout(r, 50));

    const result = childWorker.sent.find((m: any) => m.type === 'message_parent_result');
    expect(result).toBeDefined();
    expect(result.requestId).toBe('mp-2');
    expect(result.summary).toBe('Message queued for the parent run.');
    expect(result.runId).toBeDefined();
  });

  it('routes message from delegate child to parent agent', async () => {
    // Start a run on the parent agent
    await daemon.startRun('agent-1', 'manual', 'hello');
    const parentWorker = mocks.latestFakeChild;

    // Delegate to child agent
    parentWorker.emit('message', {
      type: 'delegate_request',
      requestId: 'del-1',
      targetAgent: 'child-agent',
      input: 'do research',
    });
    await new Promise(r => setTimeout(r, 50));

    const childWorker = mocks.latestFakeChild;
    expect(childWorker).not.toBe(parentWorker);

    // Child agent sends message_parent_request
    childWorker.emit('message', {
      type: 'message_parent_request',
      requestId: 'mp-del',
      message: 'Research progress: 50%',
    });
    await new Promise(r => setTimeout(r, 50));

    // Parent should receive the inject
    const injectMsg = parentWorker.sent.find((m: any) => m.type === 'inject');
    expect(injectMsg).toBeDefined();
    expect(injectMsg.message).toBe('Research progress: 50%');

    // Author metadata should reference the child agent
    expect(injectMsg.messageMeta.author.agentId).toBe(mockChildAgentData.id);
    expect(injectMsg.messageMeta.author.label).toBe(mockChildAgentData.name);

    // Child should get the result
    const result = childWorker.sent.find((m: any) => m.type === 'message_parent_result');
    expect(result).toBeDefined();
    expect(result.requestId).toBe('mp-del');
    expect(result.summary).toBe('Message queued for the parent run.');
  });

  it('fails when child has no parent run', async () => {
    // Start a top-level run (no parent)
    await daemon.startRun('agent-1', 'manual', 'hello');
    const worker = mocks.latestFakeChild;

    // Try to message parent — should fail since this is a top-level run
    worker.emit('message', {
      type: 'message_parent_request',
      requestId: 'mp-fail',
      message: 'This should fail',
    });
    await new Promise(r => setTimeout(r, 50));

    // The daemon logs the error and sends the result back as an error
    // Since handleMessageParentRequest throws, the catch block sends an error result
    const result = worker.sent.find((m: any) => m.type === 'message_parent_result');
    expect(result).toBeDefined();
    expect(result.requestId).toBe('mp-fail');
    expect(result.error).toBeDefined();
  });

  it('includes author shortId derived from child run id', async () => {
    await daemon.startRun('agent-1', 'manual', 'hello');
    const parentWorker = mocks.latestFakeChild;

    parentWorker.emit('message', {
      type: 'subrun_request',
      requestId: 'req-sub',
      input: 'do subtask',
    });
    await new Promise(r => setTimeout(r, 50));

    const childWorker = mocks.latestFakeChild;
    const childStartMsg = childWorker.sent[0];
    const childRunId = childStartMsg.runId;

    childWorker.emit('message', {
      type: 'message_parent_request',
      requestId: 'mp-short',
      message: 'Check this',
    });
    await new Promise(r => setTimeout(r, 50));

    const injectMsg = parentWorker.sent.find((m: any) => m.type === 'inject');
    expect(injectMsg.messageMeta.author.shortId).toBe(
      childRunId.split('-')[0].toUpperCase(),
    );
    expect(injectMsg.messageMeta.author.runId).toBe(childRunId);
  });
});

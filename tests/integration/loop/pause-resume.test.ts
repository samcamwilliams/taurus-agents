/**
 * Signal-based cancellation (AbortSignal) — tests the abort path
 * that pause/resume uses under the hood.
 *
 * The actual Pause tool requires IPC (worker ↔ daemon), so here we test
 * the abort signal mechanism directly, which is the same code path.
 */

import { describe, it, expect } from 'vitest';
import { agentLoop } from '../../../src/agents/agent-loop.js';
import { ChatML } from '../../../src/core/chatml.js';
import { InferenceService } from '../../../src/inference/service.js';
import { ToolRegistry } from '../../../src/tools/registry.js';
import { Tool } from '../../../src/tools/base.js';
import { MockInferenceProvider } from '../../helpers/mock-provider.js';
import type { AgentEvent, ToolResult } from '../../../src/core/types.js';

class SlowTool extends Tool {
  readonly name = 'Slow';
  readonly description = 'Slow tool';
  readonly inputSchema = { type: 'object', properties: {} };

  async execute(): Promise<ToolResult> {
    await new Promise((r) => setTimeout(r, 50));
    return { output: 'done', isError: false, durationMs: 50 };
  }
}

describe('abort signal', () => {
  it('aborts before first inference call', async () => {
    const controller = new AbortController();
    controller.abort(); // Already aborted

    const provider = new MockInferenceProvider([
      { text: 'Should not appear' },
    ]);
    const inference = new InferenceService(provider);
    const tools = new ToolRegistry();

    const chatml = new ChatML();
    chatml.setSystem('You are helpful.');
    chatml.appendUser('Hello');

    const events: AgentEvent[] = [];
    for await (const event of agentLoop({
      chatml, inference, tools, allowedTools: [], cwd: '/workspace',
      signal: controller.signal,
    })) {
      events.push(event);
    }

    // Should emit done immediately
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('done');
    expect(provider.callCount).toBe(0);
  });

  it('aborts between tool calls', async () => {
    const controller = new AbortController();

    const provider = new MockInferenceProvider([
      {
        toolCalls: [
          { name: 'Slow', input: {} },
          { name: 'Slow', input: {} },
        ],
      },
      { text: 'Never reached' },
    ]);
    const inference = new InferenceService(provider);

    const tools = new ToolRegistry();
    let toolCallCount = 0;
    const originalTool = new SlowTool();
    const trackedTool: Tool = Object.create(originalTool);
    trackedTool.execute = async (input, ctx) => {
      toolCallCount++;
      if (toolCallCount === 1) {
        // Abort after first tool executes
        controller.abort();
      }
      return originalTool.execute(input, ctx);
    };
    tools.register(trackedTool);

    const chatml = new ChatML();
    chatml.setSystem('You are helpful.');
    chatml.appendUser('Run slow tools.');

    const events: AgentEvent[] = [];
    for await (const event of agentLoop({
      chatml, inference, tools, allowedTools: ['Slow'], cwd: '/workspace',
      signal: controller.signal,
    })) {
      events.push(event);
    }

    // First tool ran, then abort was checked before second tool
    expect(toolCallCount).toBe(1);
    expect(events.some((e) => e.type === 'done')).toBe(true);
    expect(provider.callCount).toBe(1); // Only the tool-calling inference, not a follow-up
  });

  it('tool approval can deny a tool call', async () => {
    const provider = new MockInferenceProvider([
      { toolCalls: [{ name: 'Denied', input: { x: 1 } }] },
      { text: 'Tool was denied, continuing anyway.' },
    ]);
    const inference = new InferenceService(provider);

    const tools = new ToolRegistry();
    tools.register(new class extends Tool {
      readonly name = 'Denied';
      readonly description = 'Should be denied';
      readonly inputSchema = { type: 'object', properties: {} };
      async execute(): Promise<ToolResult> {
        return { output: 'should not run', isError: false, durationMs: 0 };
      }
    }());

    const chatml = new ChatML();
    chatml.setSystem('You are helpful.');
    chatml.appendUser('Try the denied tool.');

    const events: AgentEvent[] = [];
    for await (const event of agentLoop({
      chatml, inference, tools, allowedTools: ['Denied'], cwd: '/workspace',
      requestApproval: async () => false, // Deny everything
    })) {
      events.push(event);
    }

    const denied = events.find((e) => e.type === 'tool_denied');
    expect(denied).toBeDefined();
    expect((denied as any).name).toBe('Denied');

    // Agent should still complete (tool denied doesn't crash the loop)
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });
});

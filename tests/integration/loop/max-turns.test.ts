/**
 * Max turns limit: agent stops after N inference rounds.
 */

import { describe, it, expect } from 'vitest';
import { agentLoop } from '../../../src/agents/agent-loop.js';
import { ChatML } from '../../../src/core/chatml.js';
import { InferenceService } from '../../../src/inference/service.js';
import { ToolRegistry } from '../../../src/tools/registry.js';
import { Tool } from '../../../src/tools/base.js';
import { MockInferenceProvider } from '../../helpers/mock-provider.js';
import type { AgentEvent, ToolResult } from '../../../src/core/types.js';

class MockTool extends Tool {
  readonly name = 'Echo';
  readonly description = 'Echo tool';
  readonly inputSchema = { type: 'object', properties: { msg: { type: 'string' } }, required: ['msg'] };

  async execute(input: any): Promise<ToolResult> {
    return { output: `echo: ${input.msg}`, isError: false, durationMs: 1 };
  }
}

async function collectEvents(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

describe('max-turns', () => {
  it('stops at maxTurns and emits max_turns_reached', async () => {
    // Each turn makes a tool call, so the loop keeps going
    const provider = new MockInferenceProvider([
      { toolCalls: [{ name: 'Echo', input: { msg: 'turn1' } }] },
      { toolCalls: [{ name: 'Echo', input: { msg: 'turn2' } }] },
      { toolCalls: [{ name: 'Echo', input: { msg: 'turn3' } }] },
      // These should NOT be reached
      { text: 'Should not reach this' },
    ]);
    const inference = new InferenceService(provider);

    const tools = new ToolRegistry();
    tools.register(new MockTool());

    const chatml = new ChatML();
    chatml.setSystem('You are helpful.');
    chatml.appendUser('Keep echoing.');

    const events = await collectEvents(
      agentLoop({
        chatml, inference, tools, allowedTools: ['Echo'], cwd: '/workspace',
        maxTurns: 3,
      }),
    );

    const maxTurnsEvent = events.find((e) => e.type === 'max_turns_reached');
    expect(maxTurnsEvent).toBeDefined();

    // Should have made exactly 3 inference calls
    expect(provider.callCount).toBe(3);

    // Should NOT have a 'done' event (max_turns_reached is the terminal event)
    const done = events.find((e) => e.type === 'done');
    expect(done).toBeUndefined();
  });

  it('maxTurns=1 allows one inference call', async () => {
    const provider = new MockInferenceProvider([
      { toolCalls: [{ name: 'Echo', input: { msg: 'once' } }] },
      { text: 'never reached' },
    ]);
    const inference = new InferenceService(provider);

    const tools = new ToolRegistry();
    tools.register(new MockTool());

    const chatml = new ChatML();
    chatml.setSystem('You are helpful.');
    chatml.appendUser('Echo once.');

    const events = await collectEvents(
      agentLoop({
        chatml, inference, tools, allowedTools: ['Echo'], cwd: '/workspace',
        maxTurns: 1,
      }),
    );

    expect(provider.callCount).toBe(1);
    expect(events.some((e) => e.type === 'max_turns_reached')).toBe(true);
  });

  it('maxTurns=0 means unlimited', async () => {
    const provider = new MockInferenceProvider([
      { toolCalls: [{ name: 'Echo', input: { msg: 't1' } }] },
      { toolCalls: [{ name: 'Echo', input: { msg: 't2' } }] },
      { text: 'Done after 2 tool rounds.' },
    ]);
    const inference = new InferenceService(provider);

    const tools = new ToolRegistry();
    tools.register(new MockTool());

    const chatml = new ChatML();
    chatml.setSystem('You are helpful.');
    chatml.appendUser('Do work.');

    const events = await collectEvents(
      agentLoop({
        chatml, inference, tools, allowedTools: ['Echo'], cwd: '/workspace',
        maxTurns: 0,
      }),
    );

    // All 3 inference calls should complete
    expect(provider.callCount).toBe(3);
    expect(events.some((e) => e.type === 'done')).toBe(true);
    expect(events.some((e) => e.type === 'max_turns_reached')).toBe(false);
  });
});

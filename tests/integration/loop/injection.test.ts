/**
 * Inject message mid-run via getInjectedMessages callback.
 */

import { describe, it, expect } from 'vitest';
import { agentLoop } from '../../../src/agents/agent-loop.js';
import { ChatML } from '../../../src/core/chatml.js';
import { InferenceService } from '../../../src/inference/service.js';
import { ToolRegistry } from '../../../src/tools/registry.js';
import { MockInferenceProvider } from '../../helpers/mock-provider.js';
import type { AgentEvent } from '../../../src/core/types.js';

async function collectEvents(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

describe('injection', () => {
  it('injected message during tool round triggers another inference turn', async () => {
    const injectionQueue: { text: string }[] = [];

    const provider = new MockInferenceProvider([
      // Turn 1: respond to original message → end_turn
      // But we inject a message during this turn, so it loops back
      { text: 'Hello!' },
      // Turn 2: respond to injected message
      { text: 'You said: stop.' },
    ]);

    // Inject a message after the first inference call completes
    provider.onAfterStream = (callIndex) => {
      if (callIndex === 1) {
        // Queue message that will be picked up after end_turn check
        injectionQueue.push({ text: 'stop' });
      }
    };

    const inference = new InferenceService(provider);
    const tools = new ToolRegistry();

    const chatml = new ChatML();
    chatml.setSystem('You are helpful.');
    chatml.appendUser('Start');

    const events = await collectEvents(
      agentLoop({
        chatml, inference, tools, allowedTools: [], cwd: '/workspace',
        getInjectedMessages: () => injectionQueue.splice(0),
      }),
    );

    // Should have two stream events (two inference calls)
    const messageCompletes = events.filter(
      (e) => e.type === 'stream' && e.event.type === 'message_complete',
    );
    expect(messageCompletes.length).toBe(2);

    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
  });

  it('empty injection queue does not cause extra turns', async () => {
    const provider = new MockInferenceProvider([
      { text: 'Just a single response.' },
    ]);
    const inference = new InferenceService(provider);
    const tools = new ToolRegistry();

    const chatml = new ChatML();
    chatml.setSystem('You are helpful.');
    chatml.appendUser('Hello');

    const events = await collectEvents(
      agentLoop({
        chatml, inference, tools, allowedTools: [], cwd: '/workspace',
        getInjectedMessages: () => [],
      }),
    );

    expect(provider.callCount).toBe(1);
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });
});

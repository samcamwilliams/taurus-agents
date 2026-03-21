/**
 * Tests for <message-received> XML envelope wrapping in the agent loop.
 *
 * Verifies that injected messages are wrapped with proper XML tags
 * including author metadata, so the LLM can understand who sent them.
 */

import { describe, it, expect } from 'vitest';
import { agentLoop } from '../../../src/agents/agent-loop.js';
import { ChatML } from '../../../src/core/chatml.js';
import { InferenceService } from '../../../src/inference/service.js';
import { ToolRegistry } from '../../../src/tools/registry.js';
import { MockInferenceProvider } from '../../helpers/mock-provider.js';
import type { AgentEvent } from '../../../src/core/types.js';

type InjectedMessage = {
  text: string;
  images?: { base64: string; mediaType: string }[];
  meta?: Record<string, any>;
};

async function collectEvents(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

describe('message-received envelope', () => {
  it('wraps injected message with <message-received> XML tags', async () => {
    const injectionQueue: InjectedMessage[] = [];

    const provider = new MockInferenceProvider([
      { text: 'Processing...' },
      { text: 'Got it.' },
    ]);

    provider.onAfterStream = (callIndex) => {
      if (callIndex === 1) {
        injectionQueue.push({
          text: 'Found something important',
          meta: {
            author: {
              kind: 'agent',
              agentId: 'agent-child-1',
              runId: 'run-123',
              shortId: 'RUN',
              label: 'researcher',
            },
          },
        });
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

    // Find the user_message event for the injection
    const userMsgEvents = events.filter((e) => e.type === 'user_message');
    expect(userMsgEvents.length).toBeGreaterThanOrEqual(1);

    const injectedEvent = userMsgEvents.find((e: any) =>
      typeof e.message?.content === 'string' &&
      e.message.content.includes('message-received'),
    );
    expect(injectedEvent).toBeDefined();

    const content = (injectedEvent as any).message.content as string;
    expect(content).toContain('<message-received from="researcher" run="run-123">');
    expect(content).toContain('Found something important');
    expect(content).toContain('</message-received>');
  });

  it('uses "user" as default from when no author label', async () => {
    const injectionQueue: InjectedMessage[] = [];

    const provider = new MockInferenceProvider([
      { text: 'Hi.' },
      { text: 'Ok.' },
    ]);

    provider.onAfterStream = (callIndex) => {
      if (callIndex === 1) {
        injectionQueue.push({ text: 'A plain message' });
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

    const userMsgEvents = events.filter((e) => e.type === 'user_message');
    const injectedEvent = userMsgEvents.find((e: any) =>
      typeof e.message?.content === 'string' &&
      e.message.content.includes('message-received'),
    );
    expect(injectedEvent).toBeDefined();

    const content = (injectedEvent as any).message.content as string;
    // No author → defaults to "user", no run attribute
    expect(content).toContain('<message-received from="user">');
    expect(content).not.toContain('run=');
  });

  it('preserves meta on yielded user_message event', async () => {
    const injectionQueue: InjectedMessage[] = [];
    const authorMeta = {
      author: {
        kind: 'agent',
        agentId: 'a1',
        runId: 'r1',
        shortId: 'R1',
        label: 'writer',
      },
    };

    const provider = new MockInferenceProvider([
      { text: 'First.' },
      { text: 'Second.' },
    ]);

    provider.onAfterStream = (callIndex) => {
      if (callIndex === 1) {
        injectionQueue.push({ text: 'Update', meta: authorMeta });
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

    const injectedEvent = events.find(
      (e: any) => e.type === 'user_message' && e.meta?.author?.label === 'writer',
    );
    expect(injectedEvent).toBeDefined();
    expect((injectedEvent as any).meta.author.kind).toBe('agent');
    expect((injectedEvent as any).meta.author.agentId).toBe('a1');
  });

  it('handles image-only injections as content block array', async () => {
    const injectionQueue: InjectedMessage[] = [];

    const provider = new MockInferenceProvider([
      { text: 'Analyzing.' },
      { text: 'Saw the image.' },
    ]);

    provider.onAfterStream = (callIndex) => {
      if (callIndex === 1) {
        injectionQueue.push({
          text: 'Check this screenshot',
          images: [{ base64: 'iVBOR...', mediaType: 'image/png' }],
          meta: {
            author: {
              kind: 'agent',
              agentId: 'a2',
              runId: 'r2',
              shortId: 'R2',
              label: 'observer',
            },
          },
        });
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

    // When text + images, content should be an array of blocks
    const injectedEvent = events.find(
      (e: any) => e.type === 'user_message' && e.meta?.author?.label === 'observer',
    );
    expect(injectedEvent).toBeDefined();

    const content = (injectedEvent as any).message.content;
    expect(Array.isArray(content)).toBe(true);
    expect(content.length).toBe(2); // text block + image block

    // First block: text with envelope
    expect(content[0].type).toBe('text');
    expect(content[0].text).toContain('<message-received from="observer" run="r2">');
    expect(content[0].text).toContain('Check this screenshot');

    // Second block: image
    expect(content[1].type).toBe('image');
    expect(content[1].source.media_type).toBe('image/png');
  });

  it('pre-inference drain yields user_message events before inference', async () => {
    // Pre-load a message in the queue BEFORE the loop starts
    const injectionQueue: InjectedMessage[] = [
      {
        text: 'Pre-loaded message',
        meta: { author: { kind: 'agent', agentId: 'a', runId: 'r', shortId: 'X', label: 'preloader' } },
      },
    ];

    const provider = new MockInferenceProvider([
      { text: 'Got the pre-loaded message.' },
    ]);

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

    // The user_message from the pre-loaded injection should come before any stream event
    const userMsgIdx = events.findIndex(
      (e: any) => e.type === 'user_message' && e.meta?.author?.label === 'preloader',
    );
    const firstStreamIdx = events.findIndex((e) => e.type === 'stream');

    expect(userMsgIdx).toBeGreaterThanOrEqual(0);
    expect(firstStreamIdx).toBeGreaterThan(userMsgIdx);
  });
});

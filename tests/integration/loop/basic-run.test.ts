/**
 * Basic agent loop test: user message → tool call → result → final text.
 * Calls agentLoop() directly (no fork, no IPC).
 */

import { describe, it, expect } from 'vitest';
import { agentLoop } from '../../../src/agents/agent-loop.js';
import { ChatML } from '../../../src/core/chatml.js';
import { InferenceService } from '../../../src/inference/service.js';
import { ToolRegistry } from '../../../src/tools/registry.js';
import { Tool } from '../../../src/tools/base.js';
import { MockInferenceProvider } from '../../helpers/mock-provider.js';
import type { AgentEvent, ToolResult, ToolContext } from '../../../src/core/types.js';

class MockTool extends Tool {
  readonly name: string;
  readonly description = 'Mock tool';
  readonly inputSchema = { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] };
  private results: ToolResult[];

  constructor(name: string, results: ToolResult[]) {
    super();
    this.name = name;
    this.results = results;
  }

  async execute(): Promise<ToolResult> {
    return this.results.shift() ?? { output: 'exhausted', isError: true, durationMs: 0 };
  }
}

async function collectEvents(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

describe('basic-run', () => {
  it('user message → text response (no tool calls)', async () => {
    const provider = new MockInferenceProvider([
      { text: 'Hello! How can I help?' },
    ]);
    const inference = new InferenceService(provider);
    const tools = new ToolRegistry();

    const chatml = new ChatML();
    chatml.setSystem('You are helpful.');
    chatml.appendUser('Hi there');

    const events = await collectEvents(
      agentLoop({ chatml, inference, tools, allowedTools: [], cwd: '/workspace' }),
    );

    // Should stream text then complete
    const textDelta = events.find((e) => e.type === 'stream' && e.event.type === 'text_delta');
    expect(textDelta).toBeDefined();

    const complete = events.find((e) => e.type === 'stream' && e.event.type === 'message_complete');
    expect(complete).toBeDefined();

    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();

    expect(provider.callCount).toBe(1);
  });

  it('user message → tool call → tool result → final text', async () => {
    const provider = new MockInferenceProvider([
      // Turn 1: model requests tool call
      { toolCalls: [{ name: 'Read', input: { path: '/workspace/file.txt' } }] },
      // Turn 2: model returns final text
      { text: 'The file contains: test data' },
    ]);
    const inference = new InferenceService(provider);

    const tools = new ToolRegistry();
    tools.register(new MockTool('Read', [
      { output: 'test data', isError: false, durationMs: 5 },
    ]));

    const chatml = new ChatML();
    chatml.setSystem('You are helpful.');
    chatml.appendUser('Read the file.');

    const events = await collectEvents(
      agentLoop({ chatml, inference, tools, allowedTools: ['Read'], cwd: '/workspace' }),
    );

    // Verify the sequence: stream → tool_start → tool_end → user_message → stream → done
    const toolStart = events.find((e) => e.type === 'tool_start');
    expect(toolStart).toBeDefined();
    expect((toolStart as any).name).toBe('Read');

    const toolEnd = events.find((e) => e.type === 'tool_end');
    expect(toolEnd).toBeDefined();
    expect((toolEnd as any).result.output).toBe('test data');

    const userMsg = events.find((e) => e.type === 'user_message');
    expect(userMsg).toBeDefined();

    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();

    // Two inference calls: one that triggered tool use, one that gave final text
    expect(provider.callCount).toBe(2);
  });

  it('conversation state is maintained across turns', async () => {
    const provider = new MockInferenceProvider([
      { toolCalls: [{ name: 'Read', input: { path: '/a.txt' } }] },
      { text: 'Done reading.' },
    ]);
    const inference = new InferenceService(provider);

    const tools = new ToolRegistry();
    tools.register(new MockTool('Read', [
      { output: 'file content', isError: false, durationMs: 1 },
    ]));

    const chatml = new ChatML();
    chatml.setSystem('System prompt.');
    chatml.appendUser('Read a.txt');

    await collectEvents(
      agentLoop({ chatml, inference, tools, allowedTools: ['Read'], cwd: '/workspace' }),
    );

    // ChatML should now contain: user msg, assistant (tool call), user (tool result), assistant (text)
    const messages = chatml.getMessages();
    expect(messages.length).toBe(4);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
    expect(messages[2].role).toBe('user'); // tool results
    expect(messages[3].role).toBe('assistant');
  });
});

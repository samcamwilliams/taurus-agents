/**
 * Tool returns error → agent handles and continues.
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

describe('tool-error', () => {
  it('error result is fed back and agent continues', async () => {
    const provider = new MockInferenceProvider([
      // Turn 1: try to read a file
      { toolCalls: [{ name: 'Read', input: { path: '/nonexistent' } }] },
      // Turn 2: agent acknowledges error and gives final answer
      { text: 'The file does not exist.' },
    ]);
    const inference = new InferenceService(provider);

    const tools = new ToolRegistry();
    tools.register(new MockTool('Read', [
      { output: 'Error: ENOENT: no such file or directory', isError: true, durationMs: 1 },
    ]));

    const chatml = new ChatML();
    chatml.setSystem('You are helpful.');
    chatml.appendUser('Read /nonexistent');

    const events = await collectEvents(
      agentLoop({ chatml, inference, tools, allowedTools: ['Read'], cwd: '/workspace' }),
    );

    const toolEnd = events.find((e) => e.type === 'tool_end') as any;
    expect(toolEnd.result.isError).toBe(true);
    expect(toolEnd.result.output).toContain('ENOENT');

    // Agent should still complete (not crash)
    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(provider.callCount).toBe(2);
  });

  it('tool that throws is caught and reported', async () => {
    class ThrowingTool extends Tool {
      readonly name = 'Throw';
      readonly description = 'Always throws';
      readonly inputSchema = { type: 'object', properties: {} };
      async execute(): Promise<ToolResult> {
        throw new Error('Unexpected crash!');
      }
    }

    const provider = new MockInferenceProvider([
      { toolCalls: [{ name: 'Throw', input: {} }] },
      { text: 'The tool crashed, but I recovered.' },
    ]);
    const inference = new InferenceService(provider);

    const tools = new ToolRegistry();
    tools.register(new ThrowingTool());

    const chatml = new ChatML();
    chatml.setSystem('You are helpful.');
    chatml.appendUser('Try the tool.');

    const events = await collectEvents(
      agentLoop({ chatml, inference, tools, allowedTools: ['Throw'], cwd: '/workspace' }),
    );

    // The ToolRegistry catches exceptions and returns them as isError results
    const toolEnd = events.find((e) => e.type === 'tool_end') as any;
    expect(toolEnd.result.isError).toBe(true);
    expect(toolEnd.result.output).toContain('Unexpected crash');

    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
  });

  it('unknown tool returns error without crashing', async () => {
    const provider = new MockInferenceProvider([
      { toolCalls: [{ name: 'NonexistentTool', input: { x: 1 } }] },
      { text: 'I tried a tool that does not exist.' },
    ]);
    const inference = new InferenceService(provider);

    const tools = new ToolRegistry();

    const chatml = new ChatML();
    chatml.setSystem('You are helpful.');
    chatml.appendUser('Do something.');

    const events = await collectEvents(
      agentLoop({ chatml, inference, tools, allowedTools: ['NonexistentTool'], cwd: '/workspace' }),
    );

    const toolEnd = events.find((e) => e.type === 'tool_end') as any;
    expect(toolEnd.result.isError).toBe(true);
    expect(toolEnd.result.output).toContain('Unknown tool');

    expect(events.some((e) => e.type === 'done')).toBe(true);
  });
});

/**
 * Multiple tool calls in a single assistant turn.
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
  readonly inputSchema = { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] };
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

describe('multi-tool', () => {
  it('handles two tool calls in one turn', async () => {
    const provider = new MockInferenceProvider([
      // Turn 1: two tool calls in one response
      {
        toolCalls: [
          { name: 'Glob', input: { query: '*.ts' } },
          { name: 'Grep', input: { query: 'import' } },
        ],
      },
      // Turn 2: final text
      { text: 'Found 5 TypeScript files with imports.' },
    ]);
    const inference = new InferenceService(provider);

    const tools = new ToolRegistry();
    tools.register(new MockTool('Glob', [
      { output: 'a.ts\nb.ts\nc.ts', isError: false, durationMs: 2 },
    ]));
    tools.register(new MockTool('Grep', [
      { output: 'a.ts:1:import foo', isError: false, durationMs: 3 },
    ]));

    const chatml = new ChatML();
    chatml.setSystem('You are helpful.');
    chatml.appendUser('Find TypeScript files with imports.');

    const events = await collectEvents(
      agentLoop({ chatml, inference, tools, allowedTools: ['Glob', 'Grep'], cwd: '/workspace' }),
    );

    const toolStarts = events.filter((e) => e.type === 'tool_start');
    expect(toolStarts.length).toBe(2);
    expect((toolStarts[0] as any).name).toBe('Glob');
    expect((toolStarts[1] as any).name).toBe('Grep');

    const toolEnds = events.filter((e) => e.type === 'tool_end');
    expect(toolEnds.length).toBe(2);

    expect(provider.callCount).toBe(2);
  });

  it('handles three sequential tool rounds', async () => {
    const provider = new MockInferenceProvider([
      { toolCalls: [{ name: 'Glob', input: { query: '*.ts' } }] },
      { toolCalls: [{ name: 'Grep', input: { query: 'function' } }] },
      { toolCalls: [{ name: 'Glob', input: { query: '*.test.ts' } }] },
      { text: 'Analysis complete.' },
    ]);
    const inference = new InferenceService(provider);

    const tools = new ToolRegistry();
    tools.register(new MockTool('Glob', [
      { output: 'file1.ts', isError: false, durationMs: 1 },
      { output: 'file1.test.ts', isError: false, durationMs: 1 },
    ]));
    tools.register(new MockTool('Grep', [
      { output: 'line 10: function foo()', isError: false, durationMs: 1 },
    ]));

    const chatml = new ChatML();
    chatml.setSystem('You are helpful.');
    chatml.appendUser('Analyze the codebase.');

    const events = await collectEvents(
      agentLoop({ chatml, inference, tools, allowedTools: ['Glob', 'Grep'], cwd: '/workspace' }),
    );

    // 3 tool rounds + 1 final text = 4 inference calls
    expect(provider.callCount).toBe(4);

    const toolStarts = events.filter((e) => e.type === 'tool_start');
    expect(toolStarts.length).toBe(3);
  });
});

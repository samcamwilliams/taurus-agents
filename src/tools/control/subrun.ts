import type { ToolResult, ToolContext } from '../../core/types.js';
import { Tool } from '../base.js';

export interface SubrunRequest {
  requestId: string;
  input: string;
  tools?: string[];
  max_turns?: number;
  timeout_ms?: number;
  run_id?: string;
  background?: boolean;
}

export interface SubrunResult {
  summary: string;
  runId: string;
  error?: string;
  hitMaxTurns?: boolean;
}

/**
 * SubrunTool — runs a subtask in the same container with its own conversation.
 *
 * The child shares the same agent (Docker container, model) but gets its own
 * run, conversation, and TAOR loop. Blocks until the child completes by default.
 * Set background=true to dispatch asynchronously. Provide run_id to resume a
 * previous subrun.
 *
 * The sendRequest/waitForResult callbacks are injected by the worker.
 */
export class SubrunTool extends Tool {
  readonly name = 'Subrun';
  readonly group = 'Control';
  readonly description = 'Run a subtask within yourself. The subtask will have a separate context window, but inherits your settings, your system prompt, your name, your container. Good for isolating work that would clutter your conversation. Set background=true to dispatch asynchronously. Provide run_id to resume a previous subrun.';
  readonly requiresApproval = false;
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      task: {
        type: 'string',
        description: 'The task description for the subtask.',
      },
      tools: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional tool subset for the subtask. Must be a subset of your available tools — any tools not in your set are ignored. Defaults to all your available tools.',
      },
      max_turns: {
        type: 'number',
        description: 'Max inference turns for the subtask. Default: 50.',
      },
      run_id: {
        type: 'string',
        description: 'Resume a previous subrun by its run ID.',
      },
      background: {
        type: 'boolean',
        description: 'Run in the background (default: false). Returns immediately with run_id. Use the Wait tool to collect results later.',
      },
    },
    required: ['task'],
  };

  private sendRequest: (request: SubrunRequest) => void;
  private waitForResult: (requestId: string) => Promise<SubrunResult>;

  constructor(
    sendRequest: (request: SubrunRequest) => void,
    waitForResult: (requestId: string) => Promise<SubrunResult>,
  ) {
    super();
    this.sendRequest = sendRequest;
    this.waitForResult = waitForResult;
  }

  async execute(input: { task: string; tools?: string[]; max_turns?: number; run_id?: string; background?: boolean }, _context: ToolContext): Promise<ToolResult> {
    const requestId = crypto.randomUUID();

    this.sendRequest({
      requestId,
      input: input.task,
      tools: input.tools,
      max_turns: input.max_turns,
      run_id: input.run_id,
      background: input.background,
    });

    const result = await this.waitForResult(requestId);

    if (result.error) {
      return {
        output: `Subrun error: ${result.error}${result.summary ? `\n\nPartial output: ${result.summary}` : ''}`,
        isError: true,
        durationMs: 0,
      };
    }

    if (input.background && result.runId) {
      return {
        output: `Subrun dispatched in background.\n[Run: ${result.runId}]`,
        isError: false,
        durationMs: 0,
      };
    }

    const meta: string[] = [];
    if (result.hitMaxTurns && result.runId) {
      meta.push(`[WARNING: Subrun hit its max turns limit — task may be incomplete. You can resume it with run_id "${result.runId}".]`);
    }
    meta.push(`[Completed: ${new Date().toISOString()}]`);
    if (result.runId) meta.push(`[Run: ${result.runId}]`);

    return {
      output: `${result.summary}\n${meta.join('\n')}`,
      isError: false,
      durationMs: 0,
    };
  }
}

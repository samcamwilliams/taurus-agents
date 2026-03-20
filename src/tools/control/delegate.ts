import type { ToolResult, ToolContext } from '../../core/types.js';
import { Tool } from '../base.js';

export interface DelegateRequest {
  requestId: string;
  targetAgent: string;
  input: string;
  context?: string;
  run_id?: string;
  background?: boolean;
}

export interface DelegateResult {
  summary: string;
  runId?: string;
  error?: string;
  tokens?: { input: number; output: number; cost: number };
  images?: { base64: string; mediaType: string }[];
}

/**
 * DelegateTool — delegates a task to a named child agent.
 *
 * Unlike Subrun (same agent, same container), Delegate targets a different agent
 * with its own container, prompt, tools, and persistent state. Blocks until the
 * child run completes by default. Set background=true to dispatch asynchronously.
 *
 * The sendRequest/waitForResult callbacks are injected by the worker.
 */
export class DelegateTool extends Tool {
  readonly name = 'Delegate';
  readonly group = 'Supervisor';
  readonly description = 'Delegate a task to a named child agent. The child runs in its own container with its own prompt, tools, and workspace. Set background=true to dispatch asynchronously and get the run_id back immediately. Provide run_id to resume a specific previous run.';
  readonly requiresApproval = false;
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      agent: {
        type: 'string',
        description: 'Name (key) of the child agent to delegate to. Must be a direct child of yours.',
      },
      task: {
        type: 'string',
        description: 'The task description / message to send to the child agent.',
      },
      context: {
        type: 'string',
        description: 'Optional additional context to include (e.g., results from a prior delegation).',
      },
      run_id: {
        type: 'string',
        description: 'Resume a specific previous run instead of starting a new one.',
      },
      background: {
        type: 'boolean',
        description: 'Run in the background (default: false). Returns immediately with run_id. Use the Wait tool to collect results later.',
      },
    },
    required: ['agent', 'task'],
  };

  private sendRequest: (request: DelegateRequest) => void;
  private waitForResult: (requestId: string) => Promise<DelegateResult>;

  constructor(
    sendRequest: (request: DelegateRequest) => void,
    waitForResult: (requestId: string) => Promise<DelegateResult>,
  ) {
    super();
    this.sendRequest = sendRequest;
    this.waitForResult = waitForResult;
  }

  async execute(input: { agent: string; task: string; context?: string; run_id?: string; background?: boolean }, _context: ToolContext): Promise<ToolResult> {
    const requestId = crypto.randomUUID();

    const message = input.context
      ? `${input.task}\n\nContext:\n${input.context}`
      : input.task;

    this.sendRequest({
      requestId,
      targetAgent: input.agent,
      input: message,
      run_id: input.run_id,
      background: input.background,
    });

    const result = await this.waitForResult(requestId);

    if (result.error) {
      return {
        output: `Delegate to "${input.agent}" failed: ${result.error}${result.summary ? `\n\nPartial output: ${result.summary}` : ''}`,
        isError: true,
        durationMs: 0,
      };
    }

    const tokenInfo = result.tokens
      ? `\n\n[Tokens: ${result.tokens.input}in/${result.tokens.output}out]`
      : '';
    const runInfo = result.runId ? `\n[Run: ${result.runId}]` : '';

    return {
      output: `${result.summary}${tokenInfo}${runInfo}`,
      isError: false,
      durationMs: 0,
      images: result.images?.map(img => ({
        base64: img.base64,
        mediaType: img.mediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
      })),
    };
  }
}


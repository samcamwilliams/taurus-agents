import type { ToolResult, ToolContext } from '../../core/types.js';
import { Tool } from '../base.js';

export interface DelegateRequest {
  requestId: string;
  targetAgent: string;
  input: string;
  context?: string;
}

export interface DelegateResult {
  summary: string;
  error?: string;
  tokens?: { input: number; output: number; cost: number };
}

/**
 * DelegateTool — delegates a task to a named child agent.
 *
 * Unlike Spawn (same agent, same container), Delegate targets a different agent
 * with its own container, prompt, tools, and persistent state. The parent blocks
 * until the child run completes.
 *
 * The sendRequest/waitForResult callbacks are injected by the worker.
 */
export class DelegateTool extends Tool {
  readonly name = 'Delegate';
  readonly group = 'Supervisor';
  readonly description = 'Delegate a task to a named child agent. The child agent runs in its own container with its own prompt, tools, and persistent workspace. Use this to assign work to specialists in your team. Blocks until the child completes and returns the result.';
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

  async execute(input: { agent: string; task: string; context?: string }, _context: ToolContext): Promise<ToolResult> {
    const requestId = crypto.randomUUID();

    const message = input.context
      ? `${input.task}\n\nContext:\n${input.context}`
      : input.task;

    this.sendRequest({
      requestId,
      targetAgent: input.agent,
      input: message,
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

    return {
      output: `${result.summary}${tokenInfo}`,
      isError: false,
      durationMs: 0,
    };
  }
}


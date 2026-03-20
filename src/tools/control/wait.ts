import type { ToolResult, ToolContext } from '../../core/types.js';
import { Tool } from '../base.js';

export interface WaitRequest {
  requestId: string;
  run_ids?: string[];
  timeout_ms?: number;
}

export interface WaitResult {
  completed: Record<string, { summary: string; error?: string; hitMaxTurns?: boolean }>;
  pending: string[];
  error?: string;
}

/**
 * WaitTool — wait for background runs to complete, or sleep for a duration.
 *
 * When run_ids are provided, blocks until all complete or the timeout is reached.
 * Returns which runs completed and which are still pending.
 * When only timeout_ms is provided, acts as a sleep.
 *
 * The sendRequest/waitForResult callbacks are injected by the worker.
 */
export class WaitTool extends Tool {
  readonly name = 'Wait';
  readonly group = 'Control';
  readonly description = 'Wait for background runs to complete, or sleep for a duration. Returns which runs completed and which are still pending.';
  readonly requiresApproval = false;
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      run_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Run IDs to wait for. Returns when all complete or timeout is reached.',
      },
      timeout_ms: {
        type: 'number',
        description: 'Max time to wait in ms (default: 300000). If no run_ids provided, acts as a sleep.',
      },
    },
    required: [],
  };

  private sendRequest: (request: WaitRequest) => void;
  private waitForResult: (requestId: string) => Promise<WaitResult>;

  constructor(
    sendRequest: (request: WaitRequest) => void,
    waitForResult: (requestId: string) => Promise<WaitResult>,
  ) {
    super();
    this.sendRequest = sendRequest;
    this.waitForResult = waitForResult;
  }

  async execute(input: { run_ids?: string[]; timeout_ms?: number }, _context: ToolContext): Promise<ToolResult> {
    if (!input.run_ids?.length && !input.timeout_ms) {
      return {
        output: 'Wait requires at least one of run_ids or timeout_ms.',
        isError: true,
        durationMs: 0,
      };
    }

    const requestId = crypto.randomUUID();

    this.sendRequest({
      requestId,
      run_ids: input.run_ids,
      timeout_ms: input.timeout_ms,
    });

    const result = await this.waitForResult(requestId);

    if (result.error) {
      return {
        output: `Wait failed: ${result.error}`,
        isError: true,
        durationMs: 0,
      };
    }

    const parts: string[] = [];

    if (Object.keys(result.completed).length > 0) {
      for (const [runId, info] of Object.entries(result.completed)) {
        const maxTurnsTag = info.hitMaxTurns ? ' [HIT MAX TURNS — may be incomplete]' : '';
        if (info.error) {
          parts.push(`[${runId}] Error: ${info.error}${info.summary ? `\n${info.summary}` : ''}${maxTurnsTag}`);
        } else {
          parts.push(`[${runId}]${maxTurnsTag} ${info.summary}`);
        }
      }
    }

    if (result.pending.length > 0) {
      parts.push(`\nStill pending: ${result.pending.join(', ')}`);
    }

    if (parts.length === 0) {
      parts.push('Wait completed.');
    }

    return {
      output: parts.join('\n\n'),
      isError: false,
      durationMs: 0,
    };
  }
}

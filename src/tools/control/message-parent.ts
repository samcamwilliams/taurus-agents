import type { ToolResult, ToolContext } from '../../core/types.js';
import { Tool } from '../base.js';

export interface MessageParentRequest {
  requestId: string;
  message: string;
}

export interface MessageParentResult {
  summary: string;
  runId?: string;
  error?: string;
}

/**
 * MessageParentTool — queue a message into the parent/delegator run.
 *
 * Uses the same injection path Taurus already uses for human messages, so the
 * parent receives it on the next loop turn.
 */
export class MessageParentTool extends Tool {
  readonly name = 'MessageParent';
  readonly group = 'Control';
  readonly description = 'Queue a message into the run that launched you. Taurus prefixes the sender and timestamp automatically, and the parent receives it on the next turn.';
  readonly requiresApproval = false;
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      message: {
        type: 'string',
        description: 'Message to send to the parent run.',
      },
    },
    required: ['message'],
  };

  private sendRequest: (request: MessageParentRequest) => void;
  private waitForResult: (requestId: string) => Promise<MessageParentResult>;

  constructor(
    sendRequest: (request: MessageParentRequest) => void,
    waitForResult: (requestId: string) => Promise<MessageParentResult>,
  ) {
    super();
    this.sendRequest = sendRequest;
    this.waitForResult = waitForResult;
  }

  async execute(input: { message: string }, _context: ToolContext): Promise<ToolResult> {
    const requestId = crypto.randomUUID();

    this.sendRequest({
      requestId,
      message: input.message,
    });

    const result = await this.waitForResult(requestId);

    if (result.error) {
      return {
        output: `MessageParent failed: ${result.error}`,
        isError: true,
        durationMs: 0,
      };
    }

    return {
      output: result.runId
        ? `${result.summary}\n[Run: ${result.runId}]`
        : result.summary,
      isError: false,
      durationMs: 0,
    };
  }
}

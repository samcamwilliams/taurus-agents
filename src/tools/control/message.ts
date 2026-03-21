import type { ToolResult, ToolContext } from '../../core/types.js';
import { Tool } from '../base.js';

export interface MessageRequest {
  requestId: string;
  message: string;
}

export interface MessageResult {
  summary: string;
  runId?: string;
  error?: string;
}

/**
 * MessageTool — queue a message into the parent/delegator run.
 *
 * Uses the same injection path Taurus already uses for human messages, so the
 * parent receives it on the next loop turn.
 */
export class MessageTool extends Tool {
  readonly name = 'Message';
  readonly group = 'Control';
  readonly description = 'Send a message to the run that launched you. The message is delivered to the parent on its next turn. This does not pause your execution — use Pause if you need to wait for a response.';
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

  private sendRequest: (request: MessageRequest) => void;
  private waitForResult: (requestId: string) => Promise<MessageResult>;

  constructor(
    sendRequest: (request: MessageRequest) => void,
    waitForResult: (requestId: string) => Promise<MessageResult>,
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
        output: `Message failed: ${result.error}`,
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

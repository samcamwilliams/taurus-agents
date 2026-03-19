import type { ToolContext, ToolResult } from '../../core/types.js';
import { Tool } from '../base.js';

export interface NotifyPayload {
  title?: string;
  message: string;
  level?: 'info' | 'success' | 'warning' | 'error';
  tag?: string;
}

export class NotifyTool extends Tool {
  readonly name = 'Notify';
  readonly group = 'Control';
  readonly description = 'Send a concise notification to Taurus web and PWA clients. Use this sparingly for high-signal events such as completed work, blockers, approvals needed soon, or failures the user should notice quickly.';
  readonly requiresApproval = false;
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      title: {
        type: 'string',
        description: 'Short title for the notification. Defaults to the agent name.',
      },
      message: {
        type: 'string',
        description: 'The notification body shown to the user. Keep it brief and actionable.',
      },
      level: {
        type: 'string',
        enum: ['info', 'success', 'warning', 'error'],
        description: 'Notification severity. Defaults to info.',
      },
      tag: {
        type: 'string',
        description: 'Optional deduplication key for replacing older notifications in the same category.',
      },
    },
    required: ['message'],
  };

  constructor(private emitNotification: (payload: NotifyPayload) => void) {
    super();
  }

  async execute(input: NotifyPayload, _context: ToolContext): Promise<ToolResult> {
    const message = input.message?.trim();
    if (!message) {
      return {
        output: 'Notification failed: message is required.',
        isError: true,
        durationMs: 0,
      };
    }

    this.emitNotification({
      title: input.title?.trim(),
      message: message.slice(0, 280),
      level: input.level ?? 'info',
      tag: input.tag?.trim() || undefined,
    });

    return {
      output: `Notification sent: ${message.slice(0, 280)}`,
      isError: false,
      durationMs: 0,
    };
  }
}

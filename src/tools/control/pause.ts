import type { ToolResult, ToolContext } from '../../core/types.js';
import { Tool } from '../base.js';

/**
 * PauseTool — allows an agent to pause and wait for input.
 *
 * When an agent calls this tool, the worker sends a 'paused' message to the
 * Daemon via IPC and blocks until a 'resume' message arrives.
 *
 * Context-aware routing:
 * - Top-level agents: pauses for human input (web UI shows resume button)
 * - Child agents (subrun/delegate): routes the pause reason to the parent
 *   agent, which can resume the child via inject_message
 *
 * The sendPause/waitForResume callbacks are injected by the agent worker.
 */
export class PauseTool extends Tool {
  readonly name = 'Pause';
  readonly group = 'Control';
  readonly description = 'Pause and wait for input. If you are a top-level agent, this waits for human input via the dashboard. If you were launched by another agent, this sends your request to the parent and waits for their response. Use when you need a decision, approval, or additional information before continuing.';
  readonly requiresApproval = false; // The tool IS the approval mechanism
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      reason: {
        type: 'string',
        description: 'Why are you pausing? This is shown to the human in the dashboard.',
      },
    },
    required: ['reason'],
  };

  private sendPause: (reason: string) => void;
  private waitForResume: () => Promise<string | undefined>;

  constructor(
    sendPause: (reason: string) => void,
    waitForResume: () => Promise<string | undefined>,
  ) {
    super();
    this.sendPause = sendPause;
    this.waitForResume = waitForResume;
  }

  async execute(input: { reason: string }, _context: ToolContext): Promise<ToolResult> {
    this.sendPause(input.reason);

    const resumeMessage = await this.waitForResume();

    const now = new Date().toISOString();
    const output = resumeMessage
      ? `Run resumed at ${now} with the message: ${resumeMessage}`
      : `Run resumed at ${now}. No additional message provided.`;

    return {
      output,
      isError: false,
      durationMs: 0,
    };
  }
}


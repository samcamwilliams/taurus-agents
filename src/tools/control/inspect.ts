import type { ToolResult, ToolContext } from '../../core/types.js';
import { Tool } from '../base.js';

export interface InspectRequest {
  requestId: string;
  agent?: string;
  run_id?: string;
  brief?: boolean;
  limit?: number;
}

export interface InspectResult {
  result: unknown;
  error?: string;
}

/**
 * InspectTool — inspect run history for yourself or a child agent.
 *
 * Without a run_id, lists recent runs. With a run_id, shows that run's
 * status and last messages. Defaults to inspecting your own runs;
 * provide `agent` to inspect a child's runs.
 */
export class InspectTool extends Tool {
  readonly name = 'Inspect';
  readonly group = 'Control';
  readonly description = `Inspect run history. Lists recent runs by default, or shows a specific run's messages.
- Inspect() — list your own recent runs
- Inspect({ run_id }) — show messages from a specific run
- Inspect({ agent: "child-name" }) — list a child agent's runs
- Inspect({ agent: "child-name", run_id }) — show a child's run messages`;
  readonly requiresApproval = false;
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      agent: {
        type: 'string',
        description: 'Child agent name to inspect. Omit to inspect your own runs.',
      },
      run_id: {
        type: 'string',
        description: 'Specific run ID to inspect. Omit to list recent runs.',
      },
      brief: {
        type: 'boolean',
        description: 'Truncate message content to 200 chars (default: true). Set false for full content.',
      },
      limit: {
        type: 'number',
        description: 'Max runs to list (default: 10). Only used when listing runs.',
      },
    },
    required: [],
  };

  private sendRequest: (request: InspectRequest) => void;
  private waitForResult: (requestId: string) => Promise<InspectResult>;

  constructor(
    sendRequest: (request: InspectRequest) => void,
    waitForResult: (requestId: string) => Promise<InspectResult>,
  ) {
    super();
    this.sendRequest = sendRequest;
    this.waitForResult = waitForResult;
  }

  async execute(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const requestId = crypto.randomUUID();

    this.sendRequest({
      requestId,
      agent: input.agent as string | undefined,
      run_id: input.run_id as string | undefined,
      brief: input.brief as boolean | undefined,
      limit: input.limit as number | undefined,
    });

    const result = await this.waitForResult(requestId);

    if (result.error) {
      return {
        output: `Inspect failed: ${result.error}`,
        isError: true,
        durationMs: 0,
      };
    }

    return {
      output: typeof result.result === 'string'
        ? result.result
        : JSON.stringify(result.result, null, 2),
      isError: false,
      durationMs: 0,
    };
  }
}

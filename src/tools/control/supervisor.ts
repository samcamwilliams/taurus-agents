import type { ToolResult, ToolContext } from '../../core/types.js';
import { Tool } from '../base.js';

export interface SupervisorRequest {
  requestId: string;
  action: string;
  params: Record<string, unknown>;
}

export interface SupervisorResult {
  result: unknown;
  error?: string;
}

/**
 * SupervisorTool — a single tool that exposes all child management operations.
 *
 * Instead of 7 separate tools (ListTeam, CreateAgent, etc.), this is one tool
 * with an `action` parameter. Keeps the tool namespace clean.
 *
 * Actions: list_team, create_agent, update_agent, delete_agent,
 *          inject_message, stop_run
 */
export class SupervisorTool extends Tool {
  readonly name = 'Supervisor';
  readonly group = 'Supervisor';
  readonly description = `Manage your child agents. Actions:
- list_team: See all children with status and current run info. No params needed.
- create_agent: Create a child. Params: { key, system_prompt, tools?, model?, resource_limits? }
- update_agent: Update a child's config. Params: { key, system_prompt?, tools?, model?, resource_limits? }
- delete_agent: Remove a child (cascades to grandchildren). Params: { key }
- inject_message: Send a message into a child's current run. Also resumes a paused child. Params: { key, message }
- stop_run: Stop a child's current run. Params: { key }`;
  readonly requiresApproval = false;
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['list_team', 'create_agent', 'update_agent', 'delete_agent', 'inject_message', 'stop_run'],
        description: 'The management action to perform.',
      },
      key: {
        type: 'string',
        description: 'Name/key of the child agent (required for all actions except list_team).',
      },
      system_prompt: {
        type: 'string',
        description: 'System prompt for create_agent or update_agent.',
      },
      tools: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tool list for create_agent or update_agent.',
      },
      model: {
        type: 'string',
        description: 'Model override for create_agent or update_agent.',
      },
      resource_limits: {
        type: 'object',
        description: 'Optional container guardrails: { cpus, memory_gb, pids_limit }.',
      },
      message: {
        type: 'string',
        description: 'Message text for inject_message.',
      },
    },
    required: ['action'],
  };

  private sendRequest: (request: SupervisorRequest) => void;
  private waitForResult: (requestId: string) => Promise<SupervisorResult>;

  constructor(
    sendRequest: (request: SupervisorRequest) => void,
    waitForResult: (requestId: string) => Promise<SupervisorResult>,
  ) {
    super();
    this.sendRequest = sendRequest;
    this.waitForResult = waitForResult;
  }

  async execute(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const requestId = crypto.randomUUID();
    const action = input.action as string;

    // Build params from input (exclude 'action' itself)
    const params: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      if (k !== 'action' && v !== undefined) params[k] = v;
    }

    this.sendRequest({ requestId, action, params });

    const result = await this.waitForResult(requestId);

    if (result.error) {
      return {
        output: `Supervisor ${action} failed: ${result.error}`,
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

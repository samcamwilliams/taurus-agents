import type { ToolResult, ToolContext } from '../core/types.js';

/**
 * Abstract base for all tools.
 * Each tool declares its name, schema, and execute method.
 */
export abstract class Tool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly inputSchema: object; // JSON Schema for the LLM API

  /** Group for UI display (e.g. 'File', 'Search', 'Web', 'Control', 'Supervisor'). */
  readonly group: string = 'Other';

  /** If true, the agent loop will ask for user approval before executing. */
  readonly requiresApproval: boolean = false;

  abstract execute(input: any, context: ToolContext): Promise<ToolResult>;
}

import { v4 as uuidv4 } from 'uuid';
import { ChatML } from '../core/chatml.js';
import type { AgentEvent } from '../core/types.js';
import type { InferenceService } from '../inference/service.js';
import type { ToolRegistry } from '../tools/registry.js';
import { agentLoop } from './agent-loop.js';

export interface AgentOpts {
  inference: InferenceService;
  tools: ToolRegistry;
  cwd: string;
  requestApproval: (toolName: string, input: any) => Promise<boolean>;
  maxTurns?: number;
}

/**
 * BaseAgent — abstract base for all agents.
 *
 * Each agent owns a ChatML, uses shared services, and defines its own
 * system prompt and tool subset.
 */
export abstract class BaseAgent {
  readonly id: string;
  protected chatml: ChatML;
  protected inference: InferenceService;
  protected tools: ToolRegistry;
  protected cwd: string;
  protected requestApproval: (toolName: string, input: any) => Promise<boolean>;
  protected maxTurns: number;

  constructor(opts: AgentOpts) {
    this.id = uuidv4();
    this.inference = opts.inference;
    this.tools = opts.tools;
    this.cwd = opts.cwd;
    this.requestApproval = opts.requestApproval;
    this.maxTurns = opts.maxTurns ?? 50;

    // Initialize ChatML with system prompt
    this.chatml = new ChatML();
    this.chatml.setSystem(this.getSystemPrompt());
  }

  /** Define the agent's personality and instructions. */
  abstract getSystemPrompt(): string;

  /** Which tools this agent is allowed to use. */
  abstract getAllowedTools(): string[];

  /**
   * Run the agent with a user message. Returns an AsyncGenerator of AgentEvents.
   * The UI iterates this to render streaming output, tool calls, etc.
   */
  async *run(userMessage: string): AsyncGenerator<AgentEvent> {
    // Add user message to conversation
    this.chatml.addUser(userMessage);

    // Delegate to the reusable TAOR loop
    yield* agentLoop({
      chatml: this.chatml,
      inference: this.inference,
      tools: this.tools,
      allowedTools: this.getAllowedTools(),
      cwd: this.cwd,
      requestApproval: this.requestApproval,
      maxTurns: this.maxTurns,
    });
  }

  /** Get the ChatML for persistence/inspection. */
  getChatML(): ChatML {
    return this.chatml;
  }

  /** Restore a ChatML from a previous session. */
  setChatML(chatml: ChatML): void {
    this.chatml = chatml;
    this.chatml.setSystem(this.getSystemPrompt());
  }

  /** Context usage estimate. */
  getContextUsage(): { tokens: number; maxTokens: number; pct: number } {
    const tokens = this.chatml.getTokenEstimate();
    const maxTokens = 200_000; // TODO: make configurable per model
    return { tokens, maxTokens, pct: Math.round((tokens / maxTokens) * 100) };
  }
}

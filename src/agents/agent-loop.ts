import type { AgentEvent, StreamEvent, ToolDef } from '../core/types.js';
import type { ChatML } from '../core/chatml.js';
import type { InferenceService } from '../inference/service.js';
import type { ToolRegistry } from '../tools/registry.js';

export interface AgentLoopParams {
  chatml: ChatML;
  inference: InferenceService;
  tools: ToolRegistry;
  allowedTools: string[];
  cwd: string;

  /** Called when a mutation tool needs user approval. Return true to allow. */
  requestApproval: (toolName: string, input: any) => Promise<boolean>;

  /** Maximum inference round-trips before stopping. */
  maxTurns?: number;
}

/**
 * The core TAOR loop: Think → Act → Observe → Repeat.
 *
 * Reusable by any agent. ~50 lines of actual logic.
 * Yields AgentEvents that the UI (or any consumer) can render.
 */
export async function* agentLoop(params: AgentLoopParams): AsyncGenerator<AgentEvent> {
  const { chatml, inference, tools, allowedTools, cwd, requestApproval, maxTurns = 50 } = params;
  let turns = 0;

  while (true) {
    if (turns >= maxTurns) {
      yield { type: 'max_turns_reached' };
      break;
    }

    // ── Think: stream inference ──
    const toolDefs = tools.getToolDefinitions(allowedTools);
    let stopReason = '';

    for await (const event of inference.complete(chatml, toolDefs)) {
      yield { type: 'stream', event };

      if (event.type === 'message_complete') {
        stopReason = event.stopReason;

        // Add assistant response to ChatML
        chatml.addAssistant(event.message.content);
      }
    }

    // If model finished without requesting tools → done
    if (stopReason !== 'tool_use') {
      yield { type: 'done' };
      return;
    }

    // ── Act: execute tool calls ──
    const toolUseBlocks = chatml.getToolUseBlocks();

    for (const toolUse of toolUseBlocks) {
      const tool = tools.get(toolUse.name);

      // Check approval for mutation tools
      if (tool?.requiresApproval) {
        const approved = await requestApproval(toolUse.name, toolUse.input);
        if (!approved) {
          chatml.addToolResult(toolUse.id, 'User denied this action.', true);
          yield { type: 'tool_denied', name: toolUse.name };
          continue;
        }
      }

      yield { type: 'tool_start', name: toolUse.name, input: toolUse.input };

      // ── Observe: execute and feed result back ──
      const result = await tools.execute(toolUse.name, toolUse.input, { cwd });
      chatml.addToolResult(toolUse.id, result.output, result.isError);

      yield { type: 'tool_end', name: toolUse.name, result };
    }

    turns++;
    // Loop back → Think again with tool results in context
  }
}

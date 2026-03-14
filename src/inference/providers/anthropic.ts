import Anthropic from '@anthropic-ai/sdk';
import type { InferenceRequest, StreamEvent, ChatMessage, ContentBlock } from '../../core/types.js';
import { InferenceProvider } from './base.js';
import { DEFAULT_LIMIT_OUTPUT_TOKENS } from '../../core/defaults.js';
// Server-side context management betas — disabled, kept for reference.
// const COMPACTION_MODELS = new Set(['claude-opus-4-6', 'claude-sonnet-4-6']);
// const COMPACTION_BETA = 'compact-2026-01-12';
// const CONTEXT_EDIT_BETA = 'context-management-2025-06-27';

export class AnthropicProvider extends InferenceProvider {
  readonly name = 'anthropic';
  private client: Anthropic;

  constructor(apiKey?: string) {
    super();
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });
  }

  async *stream(params: InferenceRequest): AsyncGenerator<StreamEvent> {
    const model = this.stripPrefix(params.model!);

    // Base request params
    const baseParams: any = {
      model,
      system: params.system,
      messages: params.messages as Anthropic.MessageParam[],
      tools: params.tools as Anthropic.Tool[] | undefined,
      max_tokens: params.maxTokens ?? DEFAULT_LIMIT_OUTPUT_TOKENS,
      // Extended thinking — temperature must be omitted (defaults to 1)
      thinking: { type: 'enabled', budget_tokens: 10000 },
      // Prompt caching — the API automatically places a breakpoint on the last
      // cacheable block and moves it forward as the conversation grows.
      // Cache read = 10% of input price; write = 1.25x. Pays for itself after 1 hit.
      cache_control: { type: 'ephemeral' },
    };

    let response: any;

    // Server-side context management betas — all disabled for now.
    // Compaction is handled client-side in agent-loop.ts (provider-agnostic).
    //
    // clear_thinking: CC doesn't use this — they keep all thinking blocks and let
    // compaction handle cleanup. Clearing after 2 turns loses the model's plan/reasoning
    // too early. Better to let thinking accumulate and compact the whole conversation
    // when context gets full.
    //
    // compact / clear_tool_uses: replaced by client-side compaction.
    //
    // if (useContextMgmt && modelDef) {
    //   response = this.client.beta.messages.stream({
    //     ...baseParams,
    //     betas: [CONTEXT_EDIT_BETA],
    //     context_management: {
    //       edits: [
    //         { type: 'clear_thinking_20251015', keep: { type: 'thinking_turns', value: 2 } },
    //         { type: 'compact_20260112', trigger: { type: 'input_tokens', value: ... } },
    //         { type: 'clear_tool_uses_20250919', keep: { type: 'tool_uses', value: 10 }, trigger: ... },
    //       ],
    //     },
    //   });
    // }
    response = this.client.messages.stream(baseParams);

    // Track tool state for streaming tool_use_end events
    let currentToolId = '';
    let currentToolJson = '';

    for await (const event of response) {
      switch (event.type) {
        case 'content_block_start': {
          const block = event.content_block;
          if (block.type === 'tool_use') {
            currentToolId = block.id;
            currentToolJson = '';
            yield { type: 'tool_use_start', id: block.id, name: block.name };
          }
          break;
        }

        case 'content_block_delta': {
          const delta = event.delta as any;
          if (delta.type === 'thinking_delta') {
            yield { type: 'thinking_delta', text: delta.thinking };
          } else if (delta.type === 'text_delta') {
            yield { type: 'text_delta', text: delta.text };
          } else if (delta.type === 'input_json_delta') {
            currentToolJson += delta.partial_json;
            yield { type: 'tool_input_delta', id: currentToolId, partialJson: delta.partial_json };
          }
          break;
        }

        case 'content_block_stop': {
          if (currentToolJson) {
            let input: any;
            try { input = JSON.parse(currentToolJson); } catch { input = currentToolJson; }
            yield { type: 'tool_use_end', id: currentToolId, input };
            currentToolJson = '';
            currentToolId = '';
          }
          break;
        }

        case 'message_stop':
          break;
      }
    }

    // Use the API's final message — preserves thinking signatures for multi-turn
    const finalMessage = await response.finalMessage();

    const assembledContent: ContentBlock[] = finalMessage.content.map((block: any) => {
      switch (block.type) {
        case 'thinking': return { type: 'thinking', thinking: block.thinking, signature: block.signature };
        case 'text': return { type: 'text', text: block.text };
        case 'tool_use': return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
        case 'compaction': return { type: 'compaction', content: block.content };
        default: return block;
      }
    });

    // Normalize usage — inputTokens is always the TOTAL (see TokenUsage docs in types.ts).
    // Anthropic reports: input_tokens (non-cached) + cache_read + cache_creation = total.
    const rawInput = finalMessage.usage.input_tokens;
    const cacheRead = (finalMessage.usage as any).cache_read_input_tokens ?? 0;
    const cacheWrite = (finalMessage.usage as any).cache_creation_input_tokens ?? 0;

    yield {
      type: 'message_complete',
      message: { role: 'assistant', content: assembledContent } as ChatMessage,
      usage: {
        inputTokens: rawInput + cacheRead + cacheWrite,
        outputTokens: finalMessage.usage.output_tokens,
        cacheRead,
        cacheWrite,
      },
      stopReason: finalMessage.stop_reason ?? 'end_turn',
    };
  }

  async countTokens(params: InferenceRequest): Promise<number> {
    try {
      const result = await this.client.messages.countTokens({
        model: this.stripPrefix(params.model!),
        system: params.system,
        messages: params.messages as Anthropic.MessageParam[],
        tools: params.tools as Anthropic.Tool[] | undefined,
      });
      return result.input_tokens;
    } catch {
      // Fallback: rough estimate
      const json = JSON.stringify(params.messages);
      return Math.ceil(json.length / 4);
    }
  }
}

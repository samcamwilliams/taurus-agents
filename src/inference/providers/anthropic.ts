import Anthropic from '@anthropic-ai/sdk';
import type { InferenceRequest, StreamEvent, ChatMessage, ContentBlock } from '../../core/types.js';
import { InferenceProvider } from './base.js';
import { DEFAULT_MODEL } from '../../core/defaults.js';

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
    const model = params.model || DEFAULT_MODEL;

    const response = this.client.messages.stream({
      model,
      system: params.system,
      messages: params.messages as Anthropic.MessageParam[],
      tools: params.tools as Anthropic.Tool[] | undefined,
      max_tokens: params.maxTokens ?? 16000,
      // Extended thinking — temperature must be omitted (defaults to 1)
      thinking: { type: 'enabled', budget_tokens: 10000 },
    });

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
        default: return block;
      }
    });

    yield {
      type: 'message_complete',
      message: { role: 'assistant', content: assembledContent } as ChatMessage,
      usage: {
        inputTokens: finalMessage.usage.input_tokens,
        outputTokens: finalMessage.usage.output_tokens,
        cacheRead: (finalMessage.usage as any).cache_read_input_tokens,
        cacheWrite: (finalMessage.usage as any).cache_creation_input_tokens,
      },
      stopReason: finalMessage.stop_reason ?? 'end_turn',
    };
  }

  async countTokens(params: InferenceRequest): Promise<number> {
    try {
      const result = await this.client.messages.countTokens({
        model: params.model || DEFAULT_MODEL,
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

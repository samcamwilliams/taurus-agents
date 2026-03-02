import Anthropic from '@anthropic-ai/sdk';
import type { InferenceRequest, StreamEvent, ChatMessage, ContentBlock } from '../../core/types.js';
import { InferenceProvider } from './base.js';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

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
      max_tokens: params.maxTokens ?? 8192,
      temperature: params.temperature,
    });

    // Track state for assembling the complete message
    const contentBlocks: ContentBlock[] = [];
    let currentToolId = '';
    let currentToolName = '';
    let currentToolJson = '';

    for await (const event of response) {
      switch (event.type) {
        case 'content_block_start': {
          const block = event.content_block;
          if (block.type === 'text') {
            contentBlocks.push({ type: 'text', text: '' });
          } else if (block.type === 'tool_use') {
            currentToolId = block.id;
            currentToolName = block.name;
            currentToolJson = '';
            contentBlocks.push({ type: 'tool_use', id: block.id, name: block.name, input: {} });
            yield { type: 'tool_use_start', id: block.id, name: block.name };
          }
          break;
        }

        case 'content_block_delta': {
          const delta = event.delta;
          if (delta.type === 'text_delta') {
            // Append to last text block
            const last = contentBlocks[contentBlocks.length - 1];
            if (last && last.type === 'text') {
              last.text += delta.text;
            }
            yield { type: 'text_delta', text: delta.text };
          } else if (delta.type === 'input_json_delta') {
            currentToolJson += delta.partial_json;
            yield { type: 'tool_input_delta', id: currentToolId, partialJson: delta.partial_json };
          }
          break;
        }

        case 'content_block_stop': {
          // If we were accumulating tool input, parse it now
          if (currentToolJson) {
            const last = contentBlocks[contentBlocks.length - 1];
            if (last && last.type === 'tool_use') {
              try {
                last.input = JSON.parse(currentToolJson);
              } catch {
                last.input = currentToolJson;
              }
              yield { type: 'tool_use_end', id: currentToolId, input: last.input };
            }
            currentToolJson = '';
            currentToolId = '';
            currentToolName = '';
          }
          break;
        }

        case 'message_stop': {
          // Don't emit here — we'll emit after getting the final message
          break;
        }
      }
    }

    // Get the final assembled message with usage stats
    const finalMessage = await response.finalMessage();

    const assembledMessage: ChatMessage = {
      role: 'assistant',
      content: contentBlocks,
    };

    yield {
      type: 'message_complete',
      message: assembledMessage,
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

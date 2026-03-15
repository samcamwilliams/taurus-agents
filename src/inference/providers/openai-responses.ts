import OpenAI from 'openai';
import type { Responses } from 'openai/resources/responses/responses';
import type { InferenceRequest, StreamEvent, ChatMessage, ContentBlock, ToolDef } from '../../core/types.js';
import { InferenceProvider } from './base.js';
import { assembleContent, estimateTokens } from './openai-helpers.js';
import { DEFAULT_LIMIT_OUTPUT_TOKENS } from '../../core/defaults.js';

/**
 * OpenAI Responses API provider.
 *
 * Used for OpenAI and xAI (any provider implementing the Responses API).
 * Supports reasoning summaries (thinking) and server-side tools (x_search for xAI).
 */
export class OpenAIResponsesProvider extends InferenceProvider {
  readonly name: string;
  readonly baseURL?: string;
  /** Server-side tools injected by the factory (e.g. x_search for xAI). */
  private serverTools: Responses.Tool[];
  private client: OpenAI;

  constructor(opts: { apiKey: string; baseURL?: string; name?: string; serverTools?: Responses.Tool[] }) {
    super();
    this.name = opts.name ?? 'openai';
    this.baseURL = opts.baseURL;
    this.serverTools = opts.serverTools ?? [];
    this.client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL });
  }

  async *stream(params: InferenceRequest): AsyncGenerator<StreamEvent> {
    const model = this.stripPrefix(params.model!);
    const input = this.convertInput(params.messages);
    const functionTools = params.tools?.length ? this.convertTools(params.tools) : [];
    const tools: Responses.Tool[] = [...this.serverTools, ...functionTools];
    const maxTokens = params.maxTokens ?? DEFAULT_LIMIT_OUTPUT_TOKENS;

    const stream = await this.client.responses.create({
      model,
      instructions: params.system || undefined,
      input,
      tools: tools.length ? tools : undefined,
      max_output_tokens: maxTokens,
      reasoning: { summary: 'auto' },
      stream: true,
    });

    // Track state across streaming events
    const toolCalls = new Map<string, { id: string; name: string; arguments: string }>();
    let textContent = '';
    let reasoningContent = '';
    let usage: any = null;
    let hasToolCalls = false;

    for await (const event of stream) {
      switch (event.type) {
        // ── Reasoning summary (thinking) ──
        case 'response.reasoning_summary_text.delta':
          reasoningContent += event.delta;
          yield { type: 'thinking_delta', text: event.delta };
          break;

        // ── Text output ──
        case 'response.output_text.delta':
          textContent += event.delta;
          yield { type: 'text_delta', text: event.delta };
          break;

        // ── Function calls ──
        case 'response.function_call_arguments.delta': {
          const tc = toolCalls.get(event.item_id);
          if (tc) {
            tc.arguments += event.delta;
            yield { type: 'tool_input_delta', id: tc.id, partialJson: event.delta };
          }
          break;
        }

        case 'response.function_call_arguments.done': {
          const tc = toolCalls.get(event.item_id);
          if (tc) {
            tc.arguments = event.arguments;
          }
          break;
        }

        // ── Output item lifecycle ──
        case 'response.output_item.added': {
          const item = event.item as any;
          if (item.type === 'function_call') {
            hasToolCalls = true;
            const callId = item.call_id || item.id;
            toolCalls.set(item.id, { id: callId, name: item.name, arguments: '' });
            yield { type: 'tool_use_start', id: callId, name: item.name };
          }
          break;
        }

        // ── Completion ──
        case 'response.completed': {
          usage = event.response.usage;
          break;
        }
      }
    }

    // Emit tool_use_end for each completed tool call
    for (const [, tc] of toolCalls) {
      let input: any;
      try { input = JSON.parse(tc.arguments); } catch { input = tc.arguments; }
      yield { type: 'tool_use_end', id: tc.id, input };
    }

    // Assemble the final message
    const content = assembleContent(textContent, reasoningContent, toolCalls);
    const stopReason = hasToolCalls ? 'tool_use' : 'end_turn';

    // Normalize usage
    const inputTokens = usage?.input_tokens ?? 0;
    const outputTokens = usage?.output_tokens ?? 0;
    const cacheRead = usage?.input_tokens_details?.cached_tokens ?? 0;
    const reasoningTokens = usage?.output_tokens_details?.reasoning_tokens ?? 0;
    // xAI reports cost_in_usd_ticks (1/10B USD) — convert to USD float.
    const nativeCost = typeof usage?.cost_in_usd_ticks === 'number'
      ? usage.cost_in_usd_ticks / 10_000_000_000
      : undefined;

    yield {
      type: 'message_complete',
      message: { role: 'assistant', content } as ChatMessage,
      usage: {
        inputTokens,
        outputTokens,
        cacheRead: cacheRead || undefined,
        reasoningTokens: reasoningTokens || undefined,
        nativeCost,
      },
      stopReason,
    };
  }

  async countTokens(params: InferenceRequest): Promise<number> {
    try {
      const model = this.stripPrefix(params.model!);
      const input = this.convertInput(params.messages);
      const tools = params.tools?.length ? this.convertTools(params.tools) : undefined;
      const result = await this.client.responses.inputTokens.count({
        model,
        input,
        instructions: params.system || undefined,
        tools,
      });
      return result.input_tokens;
    } catch {
      return estimateTokens(params.messages);
    }
  }

  // ── Format conversion: our internal (Anthropic-shaped) → Responses API ──

  private convertInput(messages: ChatMessage[]): Responses.ResponseInput {
    const input: Responses.ResponseInput = [];

    for (const msg of messages) {
      if (msg.role === 'user') {
        if (typeof msg.content === 'string') {
          input.push({ role: 'user', content: msg.content });
        } else {
          for (const block of msg.content) {
            if (block.type === 'tool_result') {
              let outputStr: string;
              if (typeof block.content === 'string') {
                outputStr = block.content;
              } else {
                outputStr = block.content
                  .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
                  .map(b => b.text)
                  .join('\n');
              }
              // Unlike Anthropic's API, OpenAI Responses API has no is_error field
              // on function_call_output. Without this prefix, the model has no signal
              // that the tool call failed and may ignore or rationalize the error.
              // Any new provider that lacks native is_error support needs this too.
              if (block.is_error) {
                outputStr = `ERROR: ${outputStr}`;
              }
              input.push({
                type: 'function_call_output',
                call_id: block.tool_use_id,
                output: outputStr,
              });
            } else if (block.type === 'text') {
              input.push({ role: 'user', content: block.text });
            } else if (block.type === 'image') {
              input.push({
                role: 'user',
                content: [{
                  type: 'input_image' as const,
                  image_url: `data:${block.source.media_type};base64,${block.source.data}`,
                  detail: 'auto' as const,
                }],
              });
            }
          }
        }
      } else if (msg.role === 'assistant') {
        if (typeof msg.content === 'string') {
          input.push({ role: 'assistant', content: msg.content });
        } else {
          const textParts: string[] = [];
          for (const block of msg.content) {
            if (block.type === 'text') {
              textParts.push(block.text);
            } else if (block.type === 'tool_use') {
              // Flush accumulated text first
              if (textParts.length > 0) {
                input.push({ role: 'assistant', content: textParts.join('\n') });
                textParts.length = 0;
              }
              input.push({
                type: 'function_call',
                call_id: block.id,
                name: block.name,
                arguments: JSON.stringify(block.input),
              });
            }
            // Skip thinking blocks — OpenAI doesn't accept them back
          }
          if (textParts.length > 0) {
            input.push({ role: 'assistant', content: textParts.join('\n') });
          }
        }
      }
    }

    return input;
  }

  private convertTools(tools: ToolDef[]): Responses.Tool[] {
    return tools.map(t => ({
      type: 'function' as const,
      name: t.name,
      description: t.description ?? undefined,
      parameters: t.input_schema as Record<string, unknown>,
      strict: false,
    }));
  }
}

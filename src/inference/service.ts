import type { StreamEvent, TokenUsage } from '../core/types.js';
import type { ChatML } from '../core/chatml.js';
import type { InferenceProvider } from './providers/base.js';

export interface CompletionOpts {
  model?: string;
  /** Output token limit per inference call. Maps to max_tokens / max_output_tokens at the provider. */
  limitOutputTokens?: number;
  temperature?: number;
  /** Disable extended thinking for this request (e.g. compaction summaries). */
  disableThinking?: boolean;
}

/**
 * InferenceService — the service agents interact with.
 *
 * Wraps a provider with usage tracking and (future) queuing/rate-limiting.
 * Agents call complete() with a ChatML and get StreamEvents back.
 */
export class InferenceService {
  private provider: InferenceProvider;
  private totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0 };

  constructor(provider: InferenceProvider) {
    this.provider = provider;
  }

  /**
   * Send a ChatML to the LLM and stream events back.
   * This is the main API agents use.
   */
  async *complete(chatml: ChatML, opts?: CompletionOpts): AsyncGenerator<StreamEvent> {
    const params = {
      system: chatml.getSystemPrompt(),
      messages: chatml.getMessages(),
      tools: chatml.getTools(),
      maxTokens: opts?.limitOutputTokens,
      temperature: opts?.temperature,
      model: opts?.model,
      disableThinking: opts?.disableThinking,
    };

    for await (const event of this.provider.stream(params)) {
      // Track usage from completion events (all fields are cumulative across turns)
      if (event.type === 'message_complete') {
        const u = event.usage;
        this.totalUsage.inputTokens += u.inputTokens;
        this.totalUsage.outputTokens += u.outputTokens;
        this.totalUsage.cacheRead = (this.totalUsage.cacheRead ?? 0) + (u.cacheRead ?? 0);
        this.totalUsage.cacheWrite = (this.totalUsage.cacheWrite ?? 0) + (u.cacheWrite ?? 0);
        this.totalUsage.reasoningTokens = (this.totalUsage.reasoningTokens ?? 0) + (u.reasoningTokens ?? 0);
        if (u.nativeCost != null) {
          this.totalUsage.nativeCost = (this.totalUsage.nativeCost ?? 0) + u.nativeCost;
        }
      }

      yield event;
    }
  }

  /**
   * Count tokens for a ChatML (useful for context budget checks).
   */
  async countTokens(chatml: ChatML): Promise<number> {
    return this.provider.countTokens({
      system: chatml.getSystemPrompt(),
      messages: chatml.getMessages(),
      tools: chatml.getTools(),
    });
  }

  getUsage(): TokenUsage {
    return { ...this.totalUsage };
  }

  getProviderName(): string {
    return this.provider.name;
  }
}

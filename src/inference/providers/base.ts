import type { InferenceRequest, StreamEvent } from '../../core/types.js';

/**
 * Abstract inference provider.
 * Implement this for each LLM backend (Anthropic, OpenAI, Gemini, local, etc.)
 *
 * Providers receive the full provider-prefixed model ID in InferenceRequest.model
 * (e.g. "anthropic/claude-sonnet-4-20250514") and strip the prefix before calling
 * their API via stripPrefix().
 */
export abstract class InferenceProvider {
  abstract readonly name: string;
  readonly baseURL?: string; // Set by providers with configurable endpoints

  /** Strip the provider prefix: "anthropic/claude-sonnet-4-20250514" → "claude-sonnet-4-20250514" */
  protected stripPrefix(model: string): string {
    const slash = model.indexOf('/');
    return slash === -1 ? model : model.slice(slash + 1);
  }

  /**
   * Stream a completion. Yields StreamEvents as they arrive.
   * The final event should be 'message_complete' with the full assembled message.
   */
  abstract stream(params: InferenceRequest): AsyncGenerator<StreamEvent>;

  /**
   * Count tokens for a set of messages + tools.
   * Used for context budget management.
   */
  abstract countTokens(params: InferenceRequest): Promise<number>;
}

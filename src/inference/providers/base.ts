import type { InferenceRequest, StreamEvent } from '../../core/types.js';

/**
 * Abstract inference provider.
 * Implement this for each LLM backend (Anthropic, OpenAI, Gemini, local, etc.)
 */
export abstract class InferenceProvider {
  abstract readonly name: string;

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

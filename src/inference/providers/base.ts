import type { InferenceRequest, StreamEvent, ChatMessage, ContentBlock, ImageBlock } from '../../core/types.js';

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
   * Convert image_gen blocks (OpenAI server-side image generation) into native
   * ImageBlocks for providers that don't understand image_gen.
   *
   * Since images can't appear in assistant messages (only user messages for
   * Anthropic and Chat Completions APIs), this extracts them from assistant
   * messages and injects them into the following user message.
   */
  protected convertImageGenBlocks(messages: ChatMessage[]): ChatMessage[] {
    // Quick check — skip if no image_gen blocks anywhere
    if (!messages.some(m => m.role === 'assistant' && Array.isArray(m.content) && m.content.some(b => b.type === 'image_gen'))) {
      return messages;
    }

    const result: ChatMessage[] = [];
    let pendingImages: ImageBlock[] = [];

    for (const msg of messages) {
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        const filtered: ContentBlock[] = [];
        for (const block of msg.content) {
          if (block.type === 'image_gen') {
            pendingImages.push({
              type: 'image',
              source: { type: 'base64', media_type: block.media_type || 'image/png', data: block.result },
            });
          } else {
            filtered.push(block);
          }
        }
        result.push({ ...msg, content: filtered.length > 0 ? filtered : [{ type: 'text', text: '[Generated an image]' }] });
      } else if (msg.role === 'user' && pendingImages.length > 0) {
        // Inject collected images into this user message
        const images = pendingImages;
        pendingImages = [];
        if (typeof msg.content === 'string') {
          result.push({ ...msg, content: [{ type: 'text', text: msg.content }, ...images] });
        } else {
          result.push({ ...msg, content: [...msg.content, ...images] });
        }
      } else {
        result.push(msg);
      }
    }
    return result;
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

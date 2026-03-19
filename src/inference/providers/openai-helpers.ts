import type { ChatMessage, ContentBlock } from '../../core/types.js';

export type ImageGenResult = { id: string; result: string; media_type: string };

/**
 * Assemble our canonical ContentBlock[] from accumulated streaming state.
 * Shared by both OpenAIResponsesProvider and OpenAIChatCompletionsProvider.
 */
export function assembleContent(
  text: string,
  reasoning: string,
  toolCalls: Map<number | string, { id: string; name: string; arguments: string }>,
  imageGens?: ImageGenResult[],
): ContentBlock[] {
  const content: ContentBlock[] = [];

  if (reasoning) {
    content.push({ type: 'thinking', thinking: reasoning });
  }
  if (text) {
    content.push({ type: 'text', text });
  }
  for (const [, tc] of toolCalls) {
    let input: any;
    try { input = JSON.parse(tc.arguments); } catch { input = tc.arguments; }
    content.push({ type: 'tool_use', id: tc.id, name: tc.name, input });
  }
  if (imageGens) {
    for (const img of imageGens) {
      content.push({ type: 'image_gen', id: img.id, result: img.result, media_type: img.media_type });
    }
  }
  if (content.length === 0) {
    content.push({ type: 'text', text: '' });
  }

  return content;
}

/**
 * Rough token estimate for OpenAI-family providers (~4 chars per token).
 */
export function estimateTokens(messages: ChatMessage[]): number {
  const json = JSON.stringify(messages);
  return Math.ceil(json.length / 4);
}

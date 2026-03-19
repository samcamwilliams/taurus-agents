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
 * Images are counted at a fixed ~1,000 tokens each (based on typical tile/patch
 * costs) rather than their base64 text length, which would massively overcount.
 */
export function estimateTokens(messages: ChatMessage[]): number {
  const IMAGE_TOKENS = 1000;
  let tokens = 0;

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      tokens += Math.ceil(msg.content.length / 4);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text') tokens += Math.ceil(block.text.length / 4);
        else if (block.type === 'image') tokens += IMAGE_TOKENS;
        else if (block.type === 'image_gen') tokens += IMAGE_TOKENS;
        else if (block.type === 'tool_use') tokens += Math.ceil(JSON.stringify(block.input).length / 4);
        else if (block.type === 'tool_result') {
          if (typeof block.content === 'string') {
            tokens += Math.ceil(block.content.length / 4);
          } else {
            for (const sub of block.content) {
              if (sub.type === 'text') tokens += Math.ceil(sub.text.length / 4);
              else if (sub.type === 'image') tokens += IMAGE_TOKENS;
            }
          }
        }
      }
    }
  }
  return tokens;
}

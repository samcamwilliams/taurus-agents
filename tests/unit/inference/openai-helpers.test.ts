import { describe, it, expect } from 'vitest';
import { assembleContent, estimateTokens } from '../../../src/inference/providers/openai-helpers.js';
import type { ChatMessage } from '../../../src/core/types.js';

describe('assembleContent', () => {
  it('creates text block from text only', () => {
    const result = assembleContent('hello', '', new Map());
    expect(result).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('creates thinking + text blocks', () => {
    const result = assembleContent('answer', 'let me think', new Map());
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ type: 'thinking', thinking: 'let me think' });
    expect(result[1]).toEqual({ type: 'text', text: 'answer' });
  });

  it('creates tool_use blocks from tool calls', () => {
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>([
      [0, { id: 'call_1', name: 'Read', arguments: '{"path":"/foo"}' }],
    ]);
    const result = assembleContent('', '', toolCalls);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('tool_use');
    expect((result[0] as any).name).toBe('Read');
    expect((result[0] as any).input).toEqual({ path: '/foo' });
  });

  it('handles invalid JSON arguments gracefully', () => {
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>([
      [0, { id: 'call_1', name: 'Bash', arguments: 'not json' }],
    ]);
    const result = assembleContent('', '', toolCalls);
    expect((result[0] as any).input).toBe('not json');
  });

  it('creates image_gen blocks', () => {
    const images = [{ id: 'img1', result: 'base64data', media_type: 'image/png' }];
    const result = assembleContent('', '', new Map(), images);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('image_gen');
  });

  it('combines all types', () => {
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>([
      [0, { id: 'c1', name: 'Bash', arguments: '{"command":"ls"}' }],
    ]);
    const images = [{ id: 'img1', result: 'data', media_type: 'image/png' }];
    const result = assembleContent('text', 'reasoning', toolCalls, images);
    expect(result.map(b => b.type)).toEqual(['thinking', 'text', 'tool_use', 'image_gen']);
  });

  it('returns empty text block when nothing provided', () => {
    const result = assembleContent('', '', new Map());
    expect(result).toEqual([{ type: 'text', text: '' }]);
  });
});

describe('estimateTokens', () => {
  it('estimates ~4 chars per token for text', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'a'.repeat(400) }, // 100 tokens
    ];
    expect(estimateTokens(messages)).toBe(100);
  });

  it('counts 1000 tokens per image', () => {
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: [{
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: 'tiny' },
        }],
      },
    ];
    expect(estimateTokens(messages)).toBe(1000);
  });

  it('returns 0 for empty messages', () => {
    expect(estimateTokens([])).toBe(0);
  });

  it('handles tool_result with string content', () => {
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 't1',
          content: 'a'.repeat(40), // 10 tokens
        }],
      },
    ];
    expect(estimateTokens(messages)).toBe(10);
  });

  it('handles tool_use blocks', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 't1',
          name: 'Read',
          input: { path: '/workspace/test.txt' },
        }],
      },
    ];
    const inputJson = JSON.stringify({ path: '/workspace/test.txt' });
    expect(estimateTokens(messages)).toBe(Math.ceil(inputJson.length / 4));
  });
});

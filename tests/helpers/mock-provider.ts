/**
 * MockInferenceProvider — test-only provider that returns scripted responses.
 *
 * Each call to stream() pops the next response from the queue.
 * Throws if the queue is exhausted (test forgot to script enough responses).
 */

import crypto from 'node:crypto';
import { InferenceProvider } from '../../src/inference/providers/base.js';
import type {
  InferenceRequest,
  StreamEvent,
  ChatMessage,
  ContentBlock,
  TokenUsage,
} from '../../src/core/types.js';

export type ScriptedResponse = {
  text?: string;
  thinking?: string;
  toolCalls?: { id?: string; name: string; input: any }[];
};

export class MockInferenceProvider extends InferenceProvider {
  readonly name = 'mock';
  private responses: ScriptedResponse[];
  /** Number of stream() calls made. */
  callCount = 0;
  /** Called after each stream() completes, with the 1-based call count. */
  onAfterStream?: (callIndex: number) => void;

  constructor(responses: ScriptedResponse[]) {
    super();
    this.responses = [...responses];
  }

  /** Push additional responses onto the queue. */
  enqueue(...responses: ScriptedResponse[]): void {
    this.responses.push(...responses);
  }

  /** Number of responses remaining in the queue. */
  get remaining(): number {
    return this.responses.length;
  }

  async *stream(_params: InferenceRequest): AsyncGenerator<StreamEvent> {
    const response = this.responses.shift();
    if (!response) {
      throw new Error(
        `MockInferenceProvider: no more scripted responses (${this.callCount} calls made). ` +
        'Did the test forget to script enough responses?',
      );
    }
    this.callCount++;

    const content: ContentBlock[] = [];

    if (response.thinking) {
      yield { type: 'thinking_delta', text: response.thinking };
      content.push({ type: 'thinking', thinking: response.thinking });
    }

    if (response.text) {
      yield { type: 'text_delta', text: response.text };
      content.push({ type: 'text', text: response.text });
    }

    if (response.toolCalls) {
      for (const tc of response.toolCalls) {
        const id = tc.id ?? `mock_${crypto.randomUUID().slice(0, 8)}`;
        yield { type: 'tool_use_start', id, name: tc.name };
        yield { type: 'tool_use_end', id, input: tc.input };
        content.push({ type: 'tool_use', id, name: tc.name, input: tc.input });
      }
    }

    // Ensure at least one content block
    if (content.length === 0) {
      content.push({ type: 'text', text: '' });
    }

    const stopReason = response.toolCalls?.length ? 'tool_use' : 'end_turn';
    const usage: TokenUsage = { inputTokens: 100, outputTokens: 50 };
    const message: ChatMessage = { role: 'assistant', content };

    yield { type: 'message_complete', message, usage, stopReason };

    this.onAfterStream?.(this.callCount);
  }

  async countTokens(params: InferenceRequest): Promise<number> {
    // Rough estimate: ~4 chars per token
    const systemLen = params.system?.length ?? 0;
    const msgLen = params.messages.reduce((sum, m) => {
      if (typeof m.content === 'string') return sum + m.content.length;
      return sum + JSON.stringify(m.content).length;
    }, 0);
    return Math.ceil((systemLen + msgLen) / 4);
  }
}

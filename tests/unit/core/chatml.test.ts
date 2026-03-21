import { describe, it, expect } from 'vitest';
import { ChatML } from '../../../src/core/chatml.js';

describe('ChatML', () => {
  describe('building', () => {
    it('sets system prompt', () => {
      const c = new ChatML().setSystem('You are helpful.');
      expect(c.getSystemPrompt()).toBe('You are helpful.');
    });

    it('adds user message', () => {
      const c = new ChatML().addUser('hello');
      expect(c.getMessages()).toEqual([{ role: 'user', content: 'hello' }]);
    });

    it('adds assistant message', () => {
      const c = new ChatML().addUser('hi').addAssistant('hello');
      expect(c.getMessageCount()).toBe(2);
      expect(c.getMessages()[1]).toEqual({ role: 'assistant', content: 'hello' });
    });

    it('adds structured content blocks', () => {
      const blocks = [{ type: 'text' as const, text: 'hello' }];
      const c = new ChatML().addUser(blocks);
      expect(c.getMessages()[0].content).toEqual(blocks);
    });
  });

  describe('appendUser', () => {
    it('merges consecutive user strings', () => {
      const c = new ChatML().addUser('first');
      c.appendUser('second');
      expect(c.getMessageCount()).toBe(1);
      expect(c.getMessages()[0].content).toBe('first\n\nsecond');
    });

    it('creates new message after assistant', () => {
      const c = new ChatML()
        .addUser('q')
        .addAssistant('a')
        .appendUser('followup');
      expect(c.getMessageCount()).toBe(3);
      expect(c.getMessages()[2]).toEqual({ role: 'user', content: 'followup' });
    });

    it('merges blocks into existing block array', () => {
      const c = new ChatML().addUser([{ type: 'text' as const, text: 'first' }]);
      c.appendUser([{ type: 'text' as const, text: 'second' }]);
      expect(c.getMessageCount()).toBe(1);
      const content = c.getMessages()[0].content as any[];
      expect(content).toHaveLength(2);
    });

    it('converts string to blocks when appending blocks to string user', () => {
      const c = new ChatML().addUser('text msg');
      c.appendUser([{ type: 'text' as const, text: 'block msg' }]);
      expect(c.getMessageCount()).toBe(1);
      const content = c.getMessages()[0].content as any[];
      expect(content[0]).toEqual({ type: 'text', text: 'text msg' });
      expect(content[1]).toEqual({ type: 'text', text: 'block msg' });
    });
  });

  describe('addToolResult', () => {
    it('adds tool result as user message with content array', () => {
      const c = new ChatML()
        .addUser('q')
        .addAssistant([{ type: 'tool_use', id: 't1', name: 'Read', input: {} }]);
      c.addToolResult('t1', 'file contents');
      expect(c.getMessageCount()).toBe(3);
      const msg = c.getMessages()[2];
      expect(msg.role).toBe('user');
      const content = msg.content as any[];
      expect(content[0].type).toBe('tool_result');
      expect(content[0].tool_use_id).toBe('t1');
      expect(content[0].content).toBe('file contents');
    });

    it('merges multiple tool results into one user message', () => {
      const c = new ChatML()
        .addUser('q')
        .addAssistant([
          { type: 'tool_use', id: 't1', name: 'Read', input: {} },
          { type: 'tool_use', id: 't2', name: 'Glob', input: {} },
        ]);
      c.addToolResult('t1', 'result 1');
      c.addToolResult('t2', 'result 2');
      expect(c.getMessageCount()).toBe(3); // user, assistant, user (merged tool results)
      const content = c.getMessages()[2].content as any[];
      expect(content).toHaveLength(2);
    });

    it('marks errors with is_error', () => {
      const c = new ChatML()
        .addUser('q')
        .addAssistant([{ type: 'tool_use', id: 't1', name: 'Read', input: {} }]);
      c.addToolResult('t1', 'file not found', true);
      const content = c.getMessages()[2].content as any[];
      expect(content[0].is_error).toBe(true);
    });
  });

  describe('getToolUseBlocks', () => {
    it('extracts tool_use blocks from last assistant message', () => {
      const c = new ChatML()
        .addUser('q')
        .addAssistant([
          { type: 'thinking', thinking: '...' },
          { type: 'tool_use', id: 't1', name: 'Read', input: { path: '/foo' } },
          { type: 'text', text: 'reading...' },
        ]);
      const blocks = c.getToolUseBlocks();
      expect(blocks).toHaveLength(1);
      expect(blocks[0].name).toBe('Read');
      expect(blocks[0].id).toBe('t1');
    });

    it('returns empty array when no assistant message', () => {
      const c = new ChatML().addUser('q');
      expect(c.getToolUseBlocks()).toEqual([]);
    });

    it('returns empty array when assistant message is string', () => {
      const c = new ChatML().addUser('q').addAssistant('just text');
      expect(c.getToolUseBlocks()).toEqual([]);
    });
  });

  describe('getTokenEstimate', () => {
    it('estimates ~4 chars per token for string messages', () => {
      const c = new ChatML()
        .setSystem('a'.repeat(400))   // 100 tokens
        .addUser('b'.repeat(200));     // 50 tokens
      expect(c.getTokenEstimate()).toBe(150);
    });

    it('counts 1000 tokens per image block', () => {
      const c = new ChatML()
        .addUser([{
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: 'image/png', data: 'abc' },
        }]);
      expect(c.getTokenEstimate()).toBe(1000);
    });

    it('counts tool_use input by JSON size', () => {
      const c = new ChatML()
        .addUser('q')
        .addAssistant([{
          type: 'tool_use',
          id: 't1',
          name: 'Read',
          input: { path: '/workspace/foo.txt' },
        }]);
      const inputJson = JSON.stringify({ path: '/workspace/foo.txt' });
      expect(c.getTokenEstimate()).toBeGreaterThanOrEqual(Math.ceil(inputJson.length / 4));
    });
  });

  describe('truncateToFit', () => {
    it('drops oldest messages to fit budget', () => {
      const c = new ChatML().setSystem('sys');
      for (let i = 0; i < 10; i++) {
        c.addUser('u'.repeat(100));
        c.addAssistant('a'.repeat(100));
      }
      const before = c.getMessageCount();
      c.truncateToFit(100);
      expect(c.getMessageCount()).toBeLessThan(before);
    });

    it('keeps at least 2 messages', () => {
      const c = new ChatML()
        .addUser('question')
        .addAssistant('answer');
      c.truncateToFit(1); // impossibly low
      expect(c.getMessageCount()).toBe(2);
    });

    it('ensures first message is from user', () => {
      const c = new ChatML()
        .addAssistant('orphan')
        .addUser('q')
        .addAssistant('a');
      c.truncateToFit(100);
      if (c.getMessageCount() > 0) {
        expect(c.getMessages()[0].role).toBe('user');
      }
    });
  });

  describe('serialization', () => {
    it('round-trips through toJSON / fromJSON', () => {
      const c = new ChatML()
        .setSystem('sys')
        .addUser('hello')
        .addAssistant('world');
      const json = c.toJSON();
      const c2 = ChatML.fromJSON(json);
      expect(c2.getSystemPrompt()).toBe('sys');
      expect(c2.getMessageCount()).toBe(2);
    });

    it('clone creates independent copy', () => {
      const c = new ChatML().setSystem('sys').addUser('msg');
      const c2 = c.clone();
      c2.addAssistant('reply');
      expect(c.getMessageCount()).toBe(1);
      expect(c2.getMessageCount()).toBe(2);
    });
  });

  describe('clearMessages', () => {
    it('removes all messages but keeps system prompt', () => {
      const c = new ChatML()
        .setSystem('sys')
        .addUser('q')
        .addAssistant('a');
      c.clearMessages();
      expect(c.getMessageCount()).toBe(0);
      expect(c.getSystemPrompt()).toBe('sys');
    });
  });

  describe('compaction helpers', () => {
    it('wraps summary in compaction markers', () => {
      const wrapped = ChatML.wrapCompactionSummary('my summary');
      expect(wrapped).toContain('<compaction_summary>');
      expect(wrapped).toContain('my summary');
      expect(wrapped).toContain('</compaction_summary>');
    });
  });
});

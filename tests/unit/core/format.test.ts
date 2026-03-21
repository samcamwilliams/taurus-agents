/**
 * Tests for format utilities — message envelope stripping, cost/token formatting.
 */

import { describe, it, expect } from 'vitest';
import {
  stripInjectedMessageEnvelope,
  fmtCost,
  fmtTokens,
} from '../../../src/web/src/utils/format.js';

describe('stripInjectedMessageEnvelope', () => {
  it('strips <message-received> envelope from plain text', () => {
    const wrapped = '<message-received from="researcher" run="ABC12345">\nHere are my findings.\n</message-received>';
    expect(stripInjectedMessageEnvelope(wrapped)).toBe('Here are my findings.');
  });

  it('strips envelope without run attribute', () => {
    const wrapped = '<message-received from="user">\nHello there.\n</message-received>';
    expect(stripInjectedMessageEnvelope(wrapped)).toBe('Hello there.');
  });

  it('preserves multiline content inside envelope', () => {
    const wrapped = '<message-received from="agent">\nLine 1\nLine 2\nLine 3\n</message-received>';
    expect(stripInjectedMessageEnvelope(wrapped)).toBe('Line 1\nLine 2\nLine 3');
  });

  it('returns non-envelope text unchanged', () => {
    const plain = 'Just a normal message.';
    expect(stripInjectedMessageEnvelope(plain)).toBe(plain);
  });

  it('strips envelope from first text block in content array', () => {
    const content = [
      { type: 'text', text: '<message-received from="writer">\nDraft ready.\n</message-received>' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
    ];
    const result = stripInjectedMessageEnvelope(content) as any[];
    expect(result[0].text).toBe('Draft ready.');
    expect(result[1]).toBe(content[1]); // image block unchanged
  });

  it('removes empty text block after stripping', () => {
    const content = [
      { type: 'text', text: '<message-received from="agent">\n\n</message-received>' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
    ];
    const result = stripInjectedMessageEnvelope(content) as any[];
    // Empty text block should be removed, only image remains
    expect(result.length).toBe(1);
    expect(result[0].type).toBe('image');
  });

  it('returns non-text content arrays unchanged', () => {
    const content = [
      { type: 'tool_use', id: 't1', name: 'Read', input: {} },
    ];
    expect(stripInjectedMessageEnvelope(content)).toBe(content);
  });

  it('handles null/undefined/empty inputs gracefully', () => {
    expect(stripInjectedMessageEnvelope(null)).toBe(null);
    expect(stripInjectedMessageEnvelope(undefined)).toBe(undefined);
    expect(stripInjectedMessageEnvelope([])).toEqual([]);
  });

  it('does not match partial envelope tags', () => {
    const partial = '<message-received from="agent">content without closing tag';
    expect(stripInjectedMessageEnvelope(partial)).toBe(partial);
  });
});

describe('fmtCost', () => {
  it('uses 6 decimals for tiny costs', () => {
    expect(fmtCost(0.000123)).toBe('$0.000123');
  });

  it('uses 4 decimals for small costs', () => {
    expect(fmtCost(0.0045)).toBe('$0.0045');
  });

  it('uses 3 decimals for normal costs', () => {
    expect(fmtCost(1.234)).toBe('$1.234');
  });
});

describe('fmtTokens', () => {
  it('formats millions', () => {
    expect(fmtTokens(1_500_000)).toBe('1.5M');
  });

  it('formats thousands', () => {
    expect(fmtTokens(15_000)).toBe('15.0K');
  });

  it('formats small numbers with locale', () => {
    const result = fmtTokens(999);
    // Locale-dependent but should contain "999"
    expect(result).toContain('999');
  });

  it('clamps negative to zero', () => {
    expect(fmtTokens(-5)).toBe('0');
  });
});

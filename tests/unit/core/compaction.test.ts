import { describe, it, expect } from 'vitest';
import { shouldCompact } from '../../../src/agents/compaction.js';

describe('shouldCompact', () => {
  // Sonnet 4: 200K context, safety factor 0.95 → capacity = 190K
  const SONNET = 'anthropic/claude-sonnet-4-20250514';

  it('returns false when well under capacity', () => {
    expect(shouldCompact(SONNET, 50_000, 16_000)).toBe(false);
  });

  it('returns true when tokens + output exceed 95% capacity', () => {
    // 190K capacity, 16K output → compact when input > 174K
    expect(shouldCompact(SONNET, 175_000, 16_000)).toBe(true);
  });

  it('returns false when just under threshold', () => {
    // 174K input + 16K output = 190K exactly = capacity → NOT over
    expect(shouldCompact(SONNET, 174_000, 16_000)).toBe(false);
  });

  it('returns true when at threshold + 1', () => {
    expect(shouldCompact(SONNET, 174_001, 16_000)).toBe(true);
  });

  it('returns false for zero tokens', () => {
    expect(shouldCompact(SONNET, 0, 16_000)).toBe(false);
  });

  it('uses fallback threshold for unknown model', () => {
    // Unknown model → fallback = 150K, no output budget check
    expect(shouldCompact('unknown/model', 100_000, 16_000)).toBe(false);
    expect(shouldCompact('unknown/model', 151_000, 16_000)).toBe(true);
  });

  it('handles large-context models (1M)', () => {
    // Opus 4.6: 1M context → capacity = 950K
    const OPUS = 'anthropic/claude-opus-4-6';
    expect(shouldCompact(OPUS, 900_000, 16_000)).toBe(false);
    expect(shouldCompact(OPUS, 940_000, 16_000)).toBe(true);
  });

  it('accounts for different output budgets', () => {
    // 190K capacity, 100K output → compact when input > 90K
    expect(shouldCompact(SONNET, 89_000, 100_000)).toBe(false);
    expect(shouldCompact(SONNET, 91_000, 100_000)).toBe(true);
  });
});

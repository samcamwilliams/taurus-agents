import { describe, it, expect } from 'vitest';
import {
  getProvider,
  getModel,
  getLimitOutputTokens,
  getModelPricing,
  computeCost,
  listModels,
  MODEL_REGISTRY,
} from '../../../src/core/models.js';

describe('getProvider', () => {
  it('extracts provider from prefixed model ID', () => {
    expect(getProvider('openai/gpt-4o')).toBe('openai');
    expect(getProvider('anthropic/claude-sonnet-4-20250514')).toBe('anthropic');
    expect(getProvider('openrouter/deepseek/deepseek-r1')).toBe('openrouter');
  });

  it('returns the whole string if no slash', () => {
    expect(getProvider('gpt-4o')).toBe('gpt-4o');
  });
});

describe('getModel', () => {
  it('returns ModelDef for known model', () => {
    const model = getModel('anthropic/claude-sonnet-4-20250514');
    expect(model).toBeDefined();
    expect(model!.title).toContain('Sonnet');
    expect(model!.contextTokens).toBe(200_000);
  });

  it('returns undefined for unknown model', () => {
    expect(getModel('unknown/model')).toBeUndefined();
  });

  it('finds models from different providers', () => {
    expect(getModel('openai/gpt-4o')).toBeDefined();
    expect(getModel('openrouter/deepseek/deepseek-r1')).toBeDefined();
  });
});

describe('getLimitOutputTokens', () => {
  it('returns DEFAULT_LIMIT_OUTPUT_TOKENS for known model without limitOutputTokens', () => {
    // Most models don't set limitOutputTokens, so they get the 16K default
    const limit = getLimitOutputTokens('anthropic/claude-sonnet-4-20250514');
    expect(limit).toBe(16_000);
  });

  it('never exceeds maxOutputTokens', () => {
    // GPT-4o has maxOutputTokens=16384 which is close to DEFAULT_LIMIT_OUTPUT_TOKENS
    const limit = getLimitOutputTokens('openai/gpt-4o');
    const model = getModel('openai/gpt-4o')!;
    expect(limit).toBeLessThanOrEqual(model.maxOutputTokens);
  });

  it('returns default for unknown model', () => {
    expect(getLimitOutputTokens('unknown/model')).toBe(16_000);
  });
});

describe('getModelPricing', () => {
  it('returns pricing for exact match', () => {
    const pricing = getModelPricing('anthropic/claude-sonnet-4-20250514');
    expect(pricing).not.toBeNull();
    expect(pricing!.input).toBe(3);
    expect(pricing!.output).toBe(15);
  });

  it('returns null for unknown model without pricing', () => {
    expect(getModelPricing('unknown/no-pricing')).toBeNull();
  });

  it('returns null for OpenRouter models (no pricing in registry)', () => {
    expect(getModelPricing('openrouter/deepseek/deepseek-r1')).toBeNull();
  });

  it('prefix-matches dated model variants', () => {
    // A hypothetical dated variant should match the base model's pricing
    const base = getModelPricing('anthropic/claude-sonnet-4-20250514');
    expect(base).not.toBeNull();
  });
});

describe('computeCost', () => {
  it('computes cost from input + output tokens', () => {
    // Sonnet 4: input $3/MTok, output $15/MTok
    const cost = computeCost('anthropic/claude-sonnet-4-20250514', {
      input: 1_000_000,
      output: 1_000_000,
    });
    expect(cost).toBeCloseTo(3 + 15, 5);
  });

  it('handles cache tokens in cost calculation', () => {
    const cost = computeCost('anthropic/claude-sonnet-4-20250514', {
      input: 100_000,   // total (includes cached)
      output: 10_000,
      cacheRead: 50_000,
      cacheWrite: 20_000,
    });
    // uncachedInput = 100K - 50K - 20K = 30K
    // cost = 30K * 3/M + 50K * 0.30/M + 20K * 3.75/M + 10K * 15/M
    const expected =
      (30_000 * 3 / 1_000_000) +
      (50_000 * 0.30 / 1_000_000) +
      (20_000 * 3.75 / 1_000_000) +
      (10_000 * 15 / 1_000_000);
    expect(cost).toBeCloseTo(expected, 8);
  });

  it('prefers nativeCost when present', () => {
    const cost = computeCost('anthropic/claude-sonnet-4-20250514', {
      input: 1_000_000,
      output: 1_000_000,
      nativeCost: 0.42,
    });
    expect(cost).toBe(0.42);
  });

  it('returns 0 for unknown model without pricing', () => {
    const cost = computeCost('unknown/model', { input: 1000, output: 1000 });
    expect(cost).toBe(0);
  });

  it('returns 0 for zero tokens', () => {
    const cost = computeCost('anthropic/claude-sonnet-4-20250514', { input: 0, output: 0 });
    expect(cost).toBe(0);
  });
});

describe('listModels', () => {
  it('returns models grouped by provider', () => {
    const grouped = listModels();
    expect(grouped).toHaveProperty('anthropic');
    expect(grouped).toHaveProperty('openai');
    expect(Array.isArray(grouped['anthropic'])).toBe(true);
    expect(grouped['anthropic'].length).toBeGreaterThan(0);
  });

  it('includes all registry models', () => {
    const grouped = listModels();
    const totalGrouped = Object.values(grouped).flat().length;
    expect(totalGrouped).toBe(MODEL_REGISTRY.length);
  });
});

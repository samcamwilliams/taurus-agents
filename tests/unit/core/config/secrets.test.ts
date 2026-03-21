import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setSecrets,
  hasSecretOverride,
  setAllowedEnvFallback,
  getSecret,
} from '../../../../src/core/config/secrets.js';

describe('secrets', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset module state between tests
    setSecrets({});
    setAllowedEnvFallback(null);
  });

  afterEach(() => {
    // Restore env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  describe('setSecrets / hasSecretOverride', () => {
    it('sets and checks overrides', () => {
      setSecrets({ ANTHROPIC_API_KEY: 'sk-test', OPENAI_API_KEY: 'ok-test' });
      expect(hasSecretOverride('ANTHROPIC_API_KEY')).toBe(true);
      expect(hasSecretOverride('OPENAI_API_KEY')).toBe(true);
      expect(hasSecretOverride('MISSING_KEY')).toBe(false);
    });

    it('clears previous overrides on re-set', () => {
      setSecrets({ KEY_A: 'a' });
      expect(hasSecretOverride('KEY_A')).toBe(true);
      setSecrets({ KEY_B: 'b' });
      expect(hasSecretOverride('KEY_A')).toBe(false);
      expect(hasSecretOverride('KEY_B')).toBe(true);
    });

    it('ignores empty values', () => {
      setSecrets({ EMPTY: '' });
      expect(hasSecretOverride('EMPTY')).toBe(false);
    });
  });

  describe('getSecret', () => {
    it('returns override when set', () => {
      setSecrets({ MY_KEY: 'override-value' });
      expect(getSecret('MY_KEY')).toBe('override-value');
    });

    it('falls back to process.env when no override', () => {
      process.env.TAURUS_TEST_SECRET = 'env-value';
      expect(getSecret('TAURUS_TEST_SECRET')).toBe('env-value');
    });

    it('prefers override over env', () => {
      process.env.MY_KEY = 'env-value';
      setSecrets({ MY_KEY: 'override-value' });
      expect(getSecret('MY_KEY')).toBe('override-value');
    });

    it('returns undefined for missing key with no env', () => {
      expect(getSecret('NONEXISTENT_KEY_12345')).toBeUndefined();
    });
  });

  describe('setAllowedEnvFallback', () => {
    it('null allows all env keys', () => {
      process.env.TAURUS_TEST_ANY = 'any-value';
      setAllowedEnvFallback(null);
      expect(getSecret('TAURUS_TEST_ANY')).toBe('any-value');
    });

    it('restricts env fallback to allowlist', () => {
      process.env.ALLOWED_KEY = 'yes';
      process.env.BLOCKED_KEY = 'no';
      setAllowedEnvFallback(['ALLOWED_KEY']);
      expect(getSecret('ALLOWED_KEY')).toBe('yes');
      expect(getSecret('BLOCKED_KEY')).toBeUndefined();
    });

    it('overrides bypass the allowlist', () => {
      setAllowedEnvFallback(['ALLOWED_KEY']);
      setSecrets({ BLOCKED_KEY: 'override' });
      expect(getSecret('BLOCKED_KEY')).toBe('override');
    });
  });
});

/**
 * Environment mode and capability resolution tests.
 *
 * Security-critical: these tests verify that production and selfhosted modes
 * correctly gate budget enforcement, secret sharing, bind mounts, etc.
 */

import { describe, it, expect } from 'vitest';
import { parseBoolEnv, resolveTaurusEnv, buildCapabilities } from '../../../../src/core/config/mode.js';

// ── parseBoolEnv ──

describe('parseBoolEnv', () => {
  it('returns undefined for undefined', () => {
    expect(parseBoolEnv(undefined)).toBeUndefined();
  });

  it('truthy: "1", "true", "yes", "on", arbitrary string', () => {
    for (const val of ['1', 'true', 'TRUE', 'yes', 'YES', 'on', 'ON', 'anything']) {
      expect(parseBoolEnv(val)).toBe(true);
    }
  });

  it('falsy: "0", "false", "no", "off"', () => {
    for (const val of ['0', 'false', 'FALSE', 'no', 'NO', 'off', 'OFF']) {
      expect(parseBoolEnv(val)).toBe(false);
    }
  });
});

// ── resolveTaurusEnv ──

describe('resolveTaurusEnv', () => {
  it('returns explicit TAURUS_ENV when set', () => {
    expect(resolveTaurusEnv({ TAURUS_ENV: 'development' })).toBe('development');
    expect(resolveTaurusEnv({ TAURUS_ENV: 'selfhosted' })).toBe('selfhosted');
    expect(resolveTaurusEnv({ TAURUS_ENV: 'production' })).toBe('production');
  });

  it('throws on invalid TAURUS_ENV', () => {
    expect(() => resolveTaurusEnv({ TAURUS_ENV: 'staging' })).toThrow(/must be/);
  });

  it('falls back to NODE_ENV=production → production', () => {
    expect(resolveTaurusEnv({ NODE_ENV: 'production' })).toBe('production');
  });

  it('falls back to NODE_ENV=development → development', () => {
    expect(resolveTaurusEnv({ NODE_ENV: 'development' })).toBe('development');
  });

  it('defaults to development when nothing is set', () => {
    expect(resolveTaurusEnv({})).toBe('development');
  });

  it('TAURUS_ENV takes precedence over NODE_ENV', () => {
    expect(resolveTaurusEnv({ TAURUS_ENV: 'selfhosted', NODE_ENV: 'production' })).toBe('selfhosted');
  });
});

// ── Capability profiles ──

describe('capability profiles', () => {
  it('development: everything loose', () => {
    const { capabilities: c } = buildCapabilities({ TAURUS_ENV: 'development' });
    expect(c.budgetEnforcement).toBe(false);
    expect(c.arbitraryBindMounts).toBe(true);
    expect(c.resourceLimitsApi).toBe(true);
    expect(c.verboseErrors).toBe(true);
    expect(c.showDefaultPassword).toBe(true);
    expect(c.shareAllSecrets).toBe(true);
  });

  it('selfhosted: like dev minus security risks', () => {
    const { capabilities: c } = buildCapabilities({ TAURUS_ENV: 'selfhosted' });
    expect(c.budgetEnforcement).toBe(false);
    expect(c.arbitraryBindMounts).toBe(true);
    expect(c.resourceLimitsApi).toBe(true);
    expect(c.verboseErrors).toBe(false);
    expect(c.showDefaultPassword).toBe(false);
    expect(c.shareAllSecrets).toBe(true);
  });

  it('production: maximum lockdown', () => {
    const { capabilities: c } = buildCapabilities({ TAURUS_ENV: 'production' });
    expect(c.budgetEnforcement).toBe(true);
    expect(c.arbitraryBindMounts).toBe(false);
    expect(c.resourceLimitsApi).toBe(false);
    expect(c.verboseErrors).toBe(false);
    expect(c.showDefaultPassword).toBe(false);
    expect(c.shareAllSecrets).toBe(false);
  });
});

// ── Env var overrides ──

describe('env var overrides', () => {
  it('override production defaults to be more permissive', () => {
    const { capabilities: c } = buildCapabilities({
      TAURUS_ENV: 'production',
      TAURUS_ALLOW_ARBITRARY_BIND_MOUNTS: 'true',
      TAURUS_BUDGET_ENFORCEMENT: '0',
    });
    expect(c.arbitraryBindMounts).toBe(true);
    expect(c.budgetEnforcement).toBe(false);
    // Non-overridden remain locked down
    expect(c.verboseErrors).toBe(false);
    expect(c.shareAllSecrets).toBe(false);
  });

  it('override development defaults to be more restrictive', () => {
    const { capabilities: c } = buildCapabilities({
      TAURUS_ENV: 'development',
      TAURUS_BUDGET_ENFORCEMENT: 'true',
      TAURUS_SHARE_ALL_SECRETS: 'false',
    });
    expect(c.budgetEnforcement).toBe(true);
    expect(c.shareAllSecrets).toBe(false);
    // Non-overridden remain loose
    expect(c.arbitraryBindMounts).toBe(true);
    expect(c.verboseErrors).toBe(true);
  });

  it('showDefaultPassword cannot be overridden — only dev mode', () => {
    const prod = buildCapabilities({ TAURUS_ENV: 'production' });
    const self = buildCapabilities({ TAURUS_ENV: 'selfhosted' });
    const dev = buildCapabilities({ TAURUS_ENV: 'development' });
    expect(prod.capabilities.showDefaultPassword).toBe(false);
    expect(self.capabilities.showDefaultPassword).toBe(false);
    expect(dev.capabilities.showDefaultPassword).toBe(true);
  });
});

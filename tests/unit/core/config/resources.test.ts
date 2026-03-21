import { describe, it, expect } from 'vitest';
import {
  resolveAgentResourceLimits,
  resourceLimitsToDockerMemoryMb,
  agentResourceLimitsFromValues,
  DEFAULT_AGENT_RESOURCE_LIMITS,
} from '../../../../src/core/config/resources.js';

describe('resolveAgentResourceLimits', () => {
  it('returns defaults when no input provided', () => {
    const result = resolveAgentResourceLimits();
    expect(result.cpus).toBe(DEFAULT_AGENT_RESOURCE_LIMITS.cpus);
    expect(result.memory_gb).toBe(DEFAULT_AGENT_RESOURCE_LIMITS.memory_gb);
    expect(result.pids_limit).toBe(DEFAULT_AGENT_RESOURCE_LIMITS.pids_limit);
  });

  it('returns defaults for undefined input', () => {
    const result = resolveAgentResourceLimits(undefined);
    expect(result).toEqual(DEFAULT_AGENT_RESOURCE_LIMITS);
  });

  it('returns defaults for empty object', () => {
    const result = resolveAgentResourceLimits({});
    expect(result).toEqual(DEFAULT_AGENT_RESOURCE_LIMITS);
  });

  it('overrides individual fields', () => {
    const result = resolveAgentResourceLimits({ cpus: 4 });
    expect(result.cpus).toBe(4);
    expect(result.memory_gb).toBe(DEFAULT_AGENT_RESOURCE_LIMITS.memory_gb);
  });

  it('overrides all fields', () => {
    const result = resolveAgentResourceLimits({ cpus: 8, memory_gb: 16, pids_limit: 512 });
    expect(result).toEqual({ cpus: 8, memory_gb: 16, pids_limit: 512 });
  });

  it('converts memory_mb to memory_gb', () => {
    const result = resolveAgentResourceLimits({ memory_mb: 2048 });
    expect(result.memory_gb).toBe(2);
  });

  it('truncates pids_limit to integer', () => {
    const result = resolveAgentResourceLimits({ pids_limit: 100.7 });
    expect(result.pids_limit).toBe(100);
  });

  it('throws on non-positive cpus', () => {
    expect(() => resolveAgentResourceLimits({ cpus: 0 })).toThrow('positive');
    expect(() => resolveAgentResourceLimits({ cpus: -1 })).toThrow('positive');
  });

  it('throws on non-positive memory', () => {
    expect(() => resolveAgentResourceLimits({ memory_gb: 0 })).toThrow('positive');
  });

  it('parses from JSON string', () => {
    const result = resolveAgentResourceLimits('{"cpus": 4, "memory_gb": 8}');
    expect(result.cpus).toBe(4);
    expect(result.memory_gb).toBe(8);
  });

  it('uses custom fallback when provided', () => {
    const fallback = { cpus: 1, memory_gb: 1, pids_limit: 64 };
    const result = resolveAgentResourceLimits({}, fallback);
    expect(result).toEqual(fallback);
  });
});

describe('resourceLimitsToDockerMemoryMb', () => {
  it('converts GB to MB', () => {
    expect(resourceLimitsToDockerMemoryMb({ cpus: 2, memory_gb: 4, pids_limit: 256 })).toBe(4096);
  });

  it('rounds to nearest MB', () => {
    expect(resourceLimitsToDockerMemoryMb({ cpus: 2, memory_gb: 1.5, pids_limit: 256 })).toBe(1536);
  });

  it('handles fractional GB', () => {
    expect(resourceLimitsToDockerMemoryMb({ cpus: 2, memory_gb: 0.5, pids_limit: 256 })).toBe(512);
  });
});

describe('agentResourceLimitsFromValues', () => {
  it('maps container_* fields to resource limits', () => {
    const result = agentResourceLimitsFromValues({
      container_cpus: 4,
      container_memory_mb: 4096,
      container_pids_limit: 128,
    });
    expect(result.cpus).toBe(4);
    expect(result.memory_gb).toBe(4); // 4096 MB → 4 GB
    expect(result.pids_limit).toBe(128);
  });

  it('falls back to defaults for missing fields', () => {
    const result = agentResourceLimitsFromValues({});
    expect(result).toEqual(DEFAULT_AGENT_RESOURCE_LIMITS);
  });
});

/**
 * Agent container resource limits — types, env-driven defaults, and parsing.
 */

import os from 'node:os';

// ── Types ──

export interface AgentResourceLimits {
  cpus: number;
  memory_gb: number;
  pids_limit: number;
}

// ── Env parsing helpers ──

function parsePositiveIntEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseOptionalPositiveIntEnv(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parsePositiveFloatEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseOptionalPositiveFloatEnv(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function computeDefaultMemoryGb(): number {
  const totalMemoryGb = os.totalmem() / (1024 ** 3);
  const halfMemoryGb = totalMemoryGb / 2;
  const nearestEvenGb = Math.round(halfMemoryGb / 2) * 2;
  return Math.max(2, nearestEvenGb || 2);
}

// ── Defaults ──

const legacyDefaultMemoryMb = parseOptionalPositiveIntEnv(process.env.TAURUS_DEFAULT_DOCKER_MEMORY_MB);
const resolvedDefaultMemoryGb = parseOptionalPositiveFloatEnv(process.env.TAURUS_DEFAULT_DOCKER_MEMORY_GB)
  ?? (legacyDefaultMemoryMb ? legacyDefaultMemoryMb / 1024 : computeDefaultMemoryGb());

export const DEFAULT_AGENT_RESOURCE_LIMITS: AgentResourceLimits = Object.freeze({
  cpus: parsePositiveFloatEnv(process.env.TAURUS_DEFAULT_DOCKER_CPUS, 2),
  memory_gb: resolvedDefaultMemoryGb,
  pids_limit: parsePositiveIntEnv(process.env.TAURUS_DEFAULT_DOCKER_PIDS_LIMIT, 256),
});

// ── Coercion / resolution ──

function coerceResourceNumber(
  raw: unknown,
  fallback: number,
  field: string,
  parser: (input: string) => number,
): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = parser(String(raw));
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be a positive number`);
  }
  return value;
}

/** Resolve a full resource limit set from partial input, falling back to defaults. */
export function resolveAgentResourceLimits(
  input?: unknown,
  fallback: AgentResourceLimits = DEFAULT_AGENT_RESOURCE_LIMITS,
): AgentResourceLimits {
  const source = typeof input === 'string'
    ? JSON.parse(input) as Record<string, unknown>
    : (input && typeof input === 'object' ? input as Record<string, unknown> : {});

  return {
    cpus: coerceResourceNumber(source.cpus, fallback.cpus, 'resource_limits.cpus', parseFloat),
    memory_gb: coerceResourceNumber(
      source.memory_gb ?? (source.memory_mb !== undefined ? Number(source.memory_mb) / 1024 : undefined),
      fallback.memory_gb,
      'resource_limits.memory_gb',
      parseFloat,
    ),
    pids_limit: Math.trunc(coerceResourceNumber(source.pids_limit, fallback.pids_limit, 'resource_limits.pids_limit', parseInt)),
  };
}

export function resourceLimitsToDockerMemoryMb(resourceLimits: AgentResourceLimits): number {
  return Math.round(resourceLimits.memory_gb * 1024);
}

export function agentResourceLimitsFromValues(values: {
  container_cpus?: unknown;
  container_memory_mb?: unknown;
  container_pids_limit?: unknown;
}): AgentResourceLimits {
  return resolveAgentResourceLimits({
    cpus: values.container_cpus,
    memory_mb: values.container_memory_mb,
    pids_limit: values.container_pids_limit,
  });
}

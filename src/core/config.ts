/**
 * Environment-driven configuration — resolved once at import time.
 *
 * TAURUS_DATA_PATH:   Base directory for all Taurus persistent data (DB, sessions,
 *                     lockfile, auth secret, drives). Default: ./data
 *
 * TAURUS_DRIVE_PATH:  Base directory for agent storage (workspace + shared volumes).
 *                     Default: ${TAURUS_DATA_PATH}/taurus-drives.
 *
 * ALLOW_ARBITRARY_BIND_MOUNTS:  Whether the agent `mounts` field (arbitrary host
 *                               bind mounts) is allowed. Default: true when
 *                               NODE_ENV=local, false otherwise. Override via
 *                               TAURUS_ALLOW_ARBITRARY_BIND_MOUNTS env var.
 *
 * drivePath():  Build an absolute path under TAURUS_DRIVE_PATH with traversal
 *               protection. Same approach as the prompt include resolver in
 *               run-worker.ts (resolve → realpath → startsWith check).
 *
 * getSecret():  Read a secret (API key etc.) from the worker-local override map,
 *               falling back to process.env. Worker processes receive per-user
 *               secrets via IPC and call setSecrets() to populate the map.
 *               This avoids spreading user secrets into process.env where they
 *               could collide with system vars like AUTH_PASSWORD or NODE_ENV.
 */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

export interface AgentResourceLimits {
  cpus: number;
  memory_gb: number;
  pids_limit: number;
}

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

// ── Data base path ──

const rawDataPath = process.env.TAURUS_DATA_PATH || './data';
const resolvedDataPath = path.resolve(rawDataPath);
fs.mkdirSync(resolvedDataPath, { recursive: true });

/** Canonicalized absolute path for all Taurus persistent data. */
export const TAURUS_DATA_PATH = fs.realpathSync(resolvedDataPath);

// ── Drive base path ──

const rawDrivePath = process.env.TAURUS_DRIVE_PATH || path.join(TAURUS_DATA_PATH, 'taurus-drives');
const resolvedDrivePath = path.resolve(rawDrivePath);
fs.mkdirSync(resolvedDrivePath, { recursive: true });

/** Canonicalized absolute path for agent drive storage. */
export const TAURUS_DRIVE_PATH = fs.realpathSync(resolvedDrivePath);

// ── Arbitrary bind mounts ──

const envBindMounts = process.env.TAURUS_ALLOW_ARBITRARY_BIND_MOUNTS;

/** Whether agents are allowed to specify custom host bind mounts.
 *  Dangerous in multi-tenant — allows container access to arbitrary host paths. */
export const ALLOW_ARBITRARY_BIND_MOUNTS: boolean =
  envBindMounts !== undefined
    ? envBindMounts === 'true'
    : process.env.NODE_ENV === 'local';

// ── Agent container defaults ──

export const DOCKER_USE_INIT =
  process.env.TAURUS_DOCKER_INIT === undefined
    ? true
    : !['0', 'false'].includes(process.env.TAURUS_DOCKER_INIT.toLowerCase());

const legacyDefaultMemoryMb = parseOptionalPositiveIntEnv(process.env.TAURUS_DEFAULT_DOCKER_MEMORY_MB);
const resolvedDefaultMemoryGb = parseOptionalPositiveFloatEnv(process.env.TAURUS_DEFAULT_DOCKER_MEMORY_GB)
  ?? (legacyDefaultMemoryMb ? legacyDefaultMemoryMb / 1024 : computeDefaultMemoryGb());

export const DEFAULT_AGENT_RESOURCE_LIMITS: AgentResourceLimits = Object.freeze({
  cpus: parsePositiveFloatEnv(process.env.TAURUS_DEFAULT_DOCKER_CPUS, 2),
  memory_gb: resolvedDefaultMemoryGb,
  pids_limit: parsePositiveIntEnv(process.env.TAURUS_DEFAULT_DOCKER_PIDS_LIMIT, 256),
});

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

// ── Secrets ──

const secretOverrides = new Map<string, string>();

/** Set per-user secret overrides (called by worker on IPC start). */
export function setSecrets(secrets: Record<string, string>): void {
  secretOverrides.clear();
  for (const [key, value] of Object.entries(secrets)) {
    if (value) secretOverrides.set(key, value);
  }
}

/** Check if the user has their own override for a key (via UserSecret, not env). */
export function hasSecretOverride(key: string): boolean {
  return secretOverrides.has(key);
}

/**
 * Env fallback allowlist — controls which process.env keys are accessible
 * to non-admin workers. null = allow all (admin / local mode).
 */
let allowedEnvFallback: Set<string> | null = null;

/** Set the env fallback allowlist. null = allow all (admin/local). */
export function setAllowedEnvFallback(keys: string[] | null): void {
  allowedEnvFallback = keys ? new Set(keys) : null;
}

/**
 * Read a secret — checks worker-local overrides (user's own keys) first,
 * then process.env filtered by the allowlist.
 *
 * In local mode or for admin users, allowedEnvFallback is null (allow all).
 * In production for non-admin users, only keys in the allowlist fall through.
 */
export function getSecret(key: string): string | undefined {
  const override = secretOverrides.get(key);
  if (override) return override;

  if (allowedEnvFallback === null || allowedEnvFallback.has(key)) {
    return process.env[key];
  }
  return undefined;
}

// ── Secure path builder ──

/**
 * Build an absolute path under TAURUS_DRIVE_PATH with traversal protection.
 *
 * Every segment is validated: no `..`, no null bytes, no path separators.
 * The joined result is verified to stay within the drive base.
 *
 * Throws on any violation — never returns an unsafe path.
 */
export function drivePath(...segments: string[]): string {
  for (const seg of segments) {
    if (!seg || seg.includes('..') || seg.includes('\0') || seg.includes('/') || seg.includes('\\')) {
      throw new Error(`Invalid drive path segment: ${JSON.stringify(seg)}`);
    }
  }
  const full = path.join(TAURUS_DRIVE_PATH, ...segments);
  if (full !== TAURUS_DRIVE_PATH && !full.startsWith(TAURUS_DRIVE_PATH + path.sep)) {
    throw new Error(`Drive path escapes base: ${full}`);
  }
  return full;
}

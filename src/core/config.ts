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

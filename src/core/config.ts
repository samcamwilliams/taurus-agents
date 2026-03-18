/**
 * Environment-driven configuration — resolved once at import time.
 *
 * TAURUS_DRIVE_PATH:  Base directory for agent storage (workspace + shared volumes).
 *                     Resolved to an absolute, canonicalized path at startup.
 *                     Default: ./data/taurus-drives (relative to project root).
 *
 * ALLOW_ARBITRARY_BIND_MOUNTS:  Whether the agent `mounts` field (arbitrary host
 *                               bind mounts) is allowed. Default: true when
 *                               NODE_ENV=local, false otherwise. Override via
 *                               TAURUS_ALLOW_ARBITRARY_BIND_MOUNTS env var.
 *
 * drivePath():  Build an absolute path under TAURUS_DRIVE_PATH with traversal
 *               protection. Same approach as the prompt include resolver in
 *               run-worker.ts (resolve → realpath → startsWith check).
 */

import path from 'node:path';
import fs from 'node:fs';

// ── Drive base path ──

const rawDrivePath = process.env.TAURUS_DRIVE_PATH || './data/taurus-drives';
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

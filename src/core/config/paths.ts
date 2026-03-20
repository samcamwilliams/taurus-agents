/**
 * Filesystem paths and secure path builders.
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
 * DOCKER_USE_INIT:  Whether to pass --init to docker create. Default: true.
 *
 * drivePath():  Build an absolute path under TAURUS_DRIVE_PATH with traversal
 *               protection (segment validation + startsWith check).
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

// ── Docker flags ──

const envBindMounts = process.env.TAURUS_ALLOW_ARBITRARY_BIND_MOUNTS;

/** Whether agents are allowed to specify custom host bind mounts.
 *  Dangerous in multi-tenant — allows container access to arbitrary host paths. */
export const ALLOW_ARBITRARY_BIND_MOUNTS: boolean =
  envBindMounts !== undefined
    ? envBindMounts === 'true'
    : process.env.NODE_ENV === 'local';

export const DOCKER_USE_INIT =
  process.env.TAURUS_DOCKER_INIT === undefined
    ? true
    : !['0', 'false'].includes(process.env.TAURUS_DOCKER_INIT.toLowerCase());

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

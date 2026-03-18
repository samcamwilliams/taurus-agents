/**
 * Lockfile — prevents multiple Taurus daemon instances from running.
 *
 * Uses a simple PID-based lockfile approach:
 * 1. Check if lockfile exists
 * 2. If it does, check if the PID inside is still running
 * 3. If it's running, fail fast with a clear error
 * 4. Otherwise, take ownership and clean up on shutdown
 */

import fs from 'node:fs';
import path from 'node:path';
import { TAURUS_DATA_PATH } from '../core/config.js';

export interface LockfileInfo {
  pid: number;
  startedAt: string;
  port: number;
}

const DEFAULT_LOCK_PATH = path.join(TAURUS_DATA_PATH, 'taurus.lock');

/**
 * Check if a process with the given PID is running.
 */
function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 doesn't actually send a signal, but checks if process exists
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    // ESRCH = No such process
    // EPERM = Process exists but we don't have permission (still running)
    return err.code === 'EPERM';
  }
}

/**
 * Read the lockfile and return its contents, or null if it doesn't exist.
 */
function readLockfile(lockPath: string): LockfileInfo | null {
  try {
    const content = fs.readFileSync(lockPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Acquire the lock. Throws if another instance is running.
 */
export function acquireLock(port: number, lockPath: string = DEFAULT_LOCK_PATH): void {
  // Ensure the data directory exists
  const dir = path.dirname(lockPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const existing = readLockfile(lockPath);

  if (existing) {
    if (isProcessRunning(existing.pid)) {
      // Another instance is actually running
      const startedAt = new Date(existing.startedAt).toLocaleString();
      throw new Error(
        `Another Taurus instance is already running!\n` +
        `  PID: ${existing.pid}\n` +
        `  Port: ${existing.port}\n` +
        `  Started: ${startedAt}\n\n` +
        `If this is a stale lock, remove ${lockPath} and try again.`
      );
    }

    // Stale lockfile — previous instance crashed without cleaning up
    console.warn(`Removing stale lockfile from PID ${existing.pid}`);
    fs.unlinkSync(lockPath);
  }

  // Write our lockfile
  const info: LockfileInfo = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    port,
  };

  fs.writeFileSync(lockPath, JSON.stringify(info, null, 2));
}

/**
 * Release the lock. Safe to call multiple times.
 */
export function releaseLock(lockPath: string = DEFAULT_LOCK_PATH): void {
  try {
    const existing = readLockfile(lockPath);

    // Only remove if it's our lockfile
    if (existing && existing.pid === process.pid) {
      fs.unlinkSync(lockPath);
    }
  } catch {
    // Ignore errors during cleanup
  }
}

/**
 * Get info about the currently running instance, if any.
 */
export function getLockInfo(lockPath: string = DEFAULT_LOCK_PATH): LockfileInfo | null {
  const info = readLockfile(lockPath);
  if (info && isProcessRunning(info.pid)) {
    return info;
  }
  return null;
}

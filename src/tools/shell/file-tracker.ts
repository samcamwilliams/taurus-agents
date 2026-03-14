import { posix } from 'node:path';

/** How long a read remains valid before the agent must re-read the file. Default: 24 hours. */
export const READ_EXPIRY_MS = 24 * 60 * 60 * 1000;

type ReadEntry = { mtime: number; readAt: number };

/**
 * FileTracker — tracks which files have been read and their mtime at read time.
 *
 * Shared between Read and Edit/Write tools to enforce freshness:
 * - Edit/Write must read a file before modifying it
 * - If the file changed since last read, must re-read first
 * - Reads older than 24 hours are treated as expired
 *
 * Paths are normalized (posix.normalize) so that ./foo, foo, and /workspace/./foo
 * all resolve to the same key.
 */
export class FileTracker {
  private readFiles = new Map<string, ReadEntry>(); // normalized path → read entry

  private norm(p: string): string { return posix.normalize(p); }

  /** Record that a file was read, with its current mtime. */
  markRead(filePath: string, mtime: number): void {
    this.readFiles.set(this.norm(filePath), { mtime, readAt: Date.now() });
  }

  /** Update mtime after a successful write/edit (so subsequent edits don't require re-read). */
  updateMtime(filePath: string, mtime: number): void {
    this.readFiles.set(this.norm(filePath), { mtime, readAt: Date.now() });
  }

  /** Clear all tracked reads. Called before rebuilding history (compaction, resume). */
  clear(): void {
    this.readFiles.clear();
  }

  /** Check if a file is safe to edit. Returns null if OK, or an error message. */
  checkFreshness(filePath: string, currentMtime: number): string | null {
    const entry = this.readFiles.get(this.norm(filePath));
    if (entry === undefined) {
      return `File has not been read yet. Read it first before editing.`;
    }
    if (Date.now() - entry.readAt > READ_EXPIRY_MS) {
      return `File was read more than 24 hours ago. Re-read it before editing.`;
    }
    if (entry.mtime !== 0 && currentMtime !== entry.mtime) {
      return `File has changed since last read. Re-read it before editing.`;
    }
    return null;
  }
}
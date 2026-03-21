import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FileTracker, READ_EXPIRY_MS } from '../../../src/tools/shell/file-tracker.js';

describe('FileTracker', () => {
  let tracker: FileTracker;

  beforeEach(() => {
    tracker = new FileTracker();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('markRead / hasRead', () => {
    it('hasRead returns false for untracked file', () => {
      expect(tracker.hasRead('/workspace/foo.txt')).toBe(false);
    });

    it('hasRead returns true after markRead', () => {
      tracker.markRead('/workspace/foo.txt', 1000);
      expect(tracker.hasRead('/workspace/foo.txt')).toBe(true);
    });

    it('normalizes paths', () => {
      tracker.markRead('/workspace/./foo.txt', 1000);
      expect(tracker.hasRead('/workspace/foo.txt')).toBe(true);
    });
  });

  describe('checkFreshness', () => {
    it('returns error if file not read', () => {
      const result = tracker.checkFreshness('/workspace/foo.txt', 1000);
      expect(result).toContain('not been read');
    });

    it('returns null if mtime matches', () => {
      tracker.markRead('/workspace/foo.txt', 1000);
      expect(tracker.checkFreshness('/workspace/foo.txt', 1000)).toBeNull();
    });

    it('returns error if mtime changed', () => {
      tracker.markRead('/workspace/foo.txt', 1000);
      const result = tracker.checkFreshness('/workspace/foo.txt', 2000);
      expect(result).toContain('changed since last read');
    });

    it('treats mtime 0 as always fresh (new file)', () => {
      tracker.markRead('/workspace/foo.txt', 0);
      expect(tracker.checkFreshness('/workspace/foo.txt', 9999)).toBeNull();
    });

    it('returns error if read is older than 24 hours', () => {
      tracker.markRead('/workspace/foo.txt', 1000);
      vi.advanceTimersByTime(READ_EXPIRY_MS + 1);
      const result = tracker.checkFreshness('/workspace/foo.txt', 1000);
      expect(result).toContain('24 hours');
    });

    it('passes if read is within 24 hours', () => {
      tracker.markRead('/workspace/foo.txt', 1000);
      vi.advanceTimersByTime(READ_EXPIRY_MS - 1000);
      expect(tracker.checkFreshness('/workspace/foo.txt', 1000)).toBeNull();
    });
  });

  describe('updateMtime', () => {
    it('updates tracked mtime for subsequent freshness checks', () => {
      tracker.markRead('/workspace/foo.txt', 1000);
      tracker.updateMtime('/workspace/foo.txt', 2000);
      expect(tracker.checkFreshness('/workspace/foo.txt', 2000)).toBeNull();
      expect(tracker.checkFreshness('/workspace/foo.txt', 1000)).toContain('changed');
    });
  });

  describe('clear', () => {
    it('removes all tracked reads', () => {
      tracker.markRead('/workspace/a.txt', 1);
      tracker.markRead('/workspace/b.txt', 2);
      tracker.clear();
      expect(tracker.hasRead('/workspace/a.txt')).toBe(false);
      expect(tracker.hasRead('/workspace/b.txt')).toBe(false);
    });
  });
});

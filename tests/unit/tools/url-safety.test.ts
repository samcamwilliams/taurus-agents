import { describe, it, expect } from 'vitest';
import { isUrlSafe } from '../../../src/tools/web/url-safety.js';

describe('isUrlSafe', () => {
  describe('safe URLs', () => {
    it('allows normal https', () => {
      expect(isUrlSafe('https://example.com')).toEqual({ safe: true });
    });

    it('allows normal http', () => {
      expect(isUrlSafe('http://example.com/path?q=1')).toEqual({ safe: true });
    });

    it('allows public IPs', () => {
      expect(isUrlSafe('http://8.8.8.8')).toEqual({ safe: true });
      expect(isUrlSafe('https://1.1.1.1')).toEqual({ safe: true });
    });
  });

  describe('blocked schemes', () => {
    it('blocks ftp', () => {
      expect(isUrlSafe('ftp://example.com').safe).toBe(false);
    });

    it('blocks file', () => {
      expect(isUrlSafe('file:///etc/passwd').safe).toBe(false);
    });

    it('blocks javascript', () => {
      expect(isUrlSafe('javascript:alert(1)').safe).toBe(false);
    });

    it('blocks data', () => {
      expect(isUrlSafe('data:text/html,<h1>hi</h1>').safe).toBe(false);
    });
  });

  describe('malformed URLs', () => {
    it('blocks empty string', () => {
      expect(isUrlSafe('').safe).toBe(false);
    });

    it('blocks garbage', () => {
      expect(isUrlSafe('not a url').safe).toBe(false);
    });
  });

  describe('embedded credentials', () => {
    it('blocks user:pass in URL', () => {
      const result = isUrlSafe('http://admin:secret@example.com');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('credentials');
    });

    it('blocks username-only', () => {
      expect(isUrlSafe('http://user@example.com').safe).toBe(false);
    });
  });

  describe('private IPv4 addresses', () => {
    it('blocks 10.x.x.x', () => {
      expect(isUrlSafe('http://10.0.0.1').safe).toBe(false);
      expect(isUrlSafe('http://10.255.255.255').safe).toBe(false);
    });

    it('blocks 172.16-31.x.x', () => {
      expect(isUrlSafe('http://172.16.0.1').safe).toBe(false);
      expect(isUrlSafe('http://172.31.255.255').safe).toBe(false);
    });

    it('allows 172.32.x.x (not private)', () => {
      expect(isUrlSafe('http://172.32.0.1').safe).toBe(true);
    });

    it('blocks 192.168.x.x', () => {
      expect(isUrlSafe('http://192.168.1.1').safe).toBe(false);
    });

    it('blocks 127.x.x.x (loopback)', () => {
      expect(isUrlSafe('http://127.0.0.1').safe).toBe(false);
      expect(isUrlSafe('http://127.0.0.2').safe).toBe(false);
    });

    it('blocks 169.254.x.x (link-local)', () => {
      expect(isUrlSafe('http://169.254.1.1').safe).toBe(false);
    });

    it('blocks 0.x.x.x', () => {
      expect(isUrlSafe('http://0.0.0.0').safe).toBe(false);
    });
  });

  describe('blocked hostnames', () => {
    it('blocks localhost', () => {
      expect(isUrlSafe('http://localhost').safe).toBe(false);
      expect(isUrlSafe('http://localhost:8080/api').safe).toBe(false);
    });

    it('blocks metadata.google.internal', () => {
      expect(isUrlSafe('http://metadata.google.internal').safe).toBe(false);
    });

    it('blocks instance-data', () => {
      expect(isUrlSafe('http://instance-data').safe).toBe(false);
    });
  });

  describe('cloud metadata endpoint', () => {
    it('blocks 169.254.169.254', () => {
      const result = isUrlSafe('http://169.254.169.254/latest/meta-data/');
      expect(result.safe).toBe(false);
      // Caught by 169.254.x.x link-local pattern before the metadata-specific check
      expect(result.reason).toContain('169.254.169.254');
    });
  });

  describe('IPv6 private', () => {
    it('blocks ::1 (loopback)', () => {
      expect(isUrlSafe('http://[::1]').safe).toBe(false);
    });

    it('blocks fc00:: (ULA)', () => {
      expect(isUrlSafe('http://[fc00::1]').safe).toBe(false);
    });

    it('blocks fd00:: (ULA)', () => {
      expect(isUrlSafe('http://[fd12::1]').safe).toBe(false);
    });

    it('blocks fe80:: (link-local)', () => {
      expect(isUrlSafe('http://[fe80::1]').safe).toBe(false);
    });
  });
});

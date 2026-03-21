import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { expandSystemPrompt } from '../../../src/core/prompt.js';

// Mock fs for include resolution — avoids needing real resources/prompts/ files
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    default: {
      ...actual,
      realpathSync: (p: string) => p,
      readFileSync: (p: string, _enc?: string) => {
        // Simulate include files
        if (p.includes('greeting.md')) return 'Hello, {{agent.name}}!';
        if (p.includes('nested.md')) return 'Nested: {{include:greeting.md}}';
        if (p.includes('deep.md')) return '{{include:nested.md}}';
        if (p.includes('missing.md')) throw new Error('ENOENT');
        return actual.readFileSync(p, _enc as any);
      },
    },
  };
});

describe('expandSystemPrompt', () => {
  const fixedDate = new Date('2026-03-21T14:30:45.000Z');

  describe('date/time placeholders', () => {
    it('expands {{datetime}} to ISO string', () => {
      const result = expandSystemPrompt('Now: {{datetime}}', {}, fixedDate);
      expect(result).toBe('Now: 2026-03-21T14:30:45.000Z');
    });

    it('expands {{date}} to YYYY-MM-DD', () => {
      const result = expandSystemPrompt('{{date}}', {}, fixedDate);
      expect(result).toBe('2026-03-21');
    });

    it('expands {{time}} to HH:MM:SS', () => {
      const result = expandSystemPrompt('{{time}}', {}, fixedDate);
      // Time depends on local timezone, just check format
      expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });

    it('expands {{year}}', () => {
      const result = expandSystemPrompt('{{year}}', {}, fixedDate);
      expect(result).toBe('2026');
    });

    it('expands {{timezone}}', () => {
      const result = expandSystemPrompt('{{timezone}}', {}, fixedDate);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('context variables', () => {
    it('expands {{agent.name}} from nested context', () => {
      const result = expandSystemPrompt('I am {{agent.name}}', {
        agent: { name: 'researcher', schedule: '0 9 * * *' },
      });
      expect(result).toBe('I am researcher');
    });

    it('expands {{agent.schedule}} from nested context', () => {
      const result = expandSystemPrompt('Schedule: {{agent.schedule}}', {
        agent: { name: 'bot', schedule: 'daily' },
      });
      expect(result).toBe('Schedule: daily');
    });

    it('leaves unknown placeholders as-is', () => {
      const result = expandSystemPrompt('{{unknown_var}}');
      expect(result).toBe('{{unknown_var}}');
    });

    it('expands flat context keys', () => {
      const result = expandSystemPrompt('Key: {{custom}}', { custom: 'value' });
      expect(result).toBe('Key: value');
    });
  });

  describe('conditionals', () => {
    it('includes block when key is truthy', () => {
      const result = expandSystemPrompt(
        '{% if agent.schedule %}Scheduled: {{agent.schedule}}{% endif %}',
        { agent: { name: 'bot', schedule: 'daily' } },
      );
      expect(result).toBe('Scheduled: daily');
    });

    it('excludes block when key is missing', () => {
      const result = expandSystemPrompt(
        'Before{% if agent.schedule %} Scheduled{% endif %} After',
        { agent: { name: 'bot' } },
      );
      expect(result).toBe('Before After');
    });

    it('supports else branch', () => {
      const result = expandSystemPrompt(
        '{% if agent.schedule %}yes{% else %}no{% endif %}',
        { agent: { name: 'bot' } },
      );
      expect(result).toBe('no');
    });

    it('handles nested conditionals', () => {
      const result = expandSystemPrompt(
        '{% if agent %}{% if agent.schedule %}S{% else %}NS{% endif %}{% endif %}',
        { agent: { name: 'bot' } },
      );
      expect(result).toBe('NS');
    });
  });

  describe('includes', () => {
    it('resolves {{include:greeting.md}}', () => {
      const result = expandSystemPrompt('{{include:greeting.md}}', {
        agent: { name: 'tester' },
      });
      expect(result).toBe('Hello, tester!');
    });

    it('resolves nested includes', () => {
      const result = expandSystemPrompt('{{include:nested.md}}', {
        agent: { name: 'deep' },
      });
      expect(result).toBe('Nested: Hello, deep!');
    });

    it('handles missing include gracefully', () => {
      const result = expandSystemPrompt('{{include:missing.md}}');
      expect(result).toContain('include failed');
    });
  });

  describe('passthrough', () => {
    it('returns plain text unchanged', () => {
      expect(expandSystemPrompt('no placeholders here')).toBe('no placeholders here');
    });

    it('handles empty string', () => {
      expect(expandSystemPrompt('')).toBe('');
    });
  });
});

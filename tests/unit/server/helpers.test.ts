import { describe, it, expect } from 'vitest';
import { route } from '../../../src/server/helpers.js';

describe('route', () => {
  const noop = async () => {};

  it('matches exact static path', () => {
    const r = route('GET', '/api/agents', noop);
    expect(r.pattern.test('/api/agents')).toBe(true);
    expect(r.method).toBe('GET');
  });

  it('does not match different path', () => {
    const r = route('GET', '/api/agents', noop);
    expect(r.pattern.test('/api/tools')).toBe(false);
  });

  it('does not match with trailing slash', () => {
    const r = route('GET', '/api/agents', noop);
    expect(r.pattern.test('/api/agents/')).toBe(false);
  });

  it('does not match partial prefix', () => {
    const r = route('GET', '/api/agents', noop);
    expect(r.pattern.test('/api/agents/extra')).toBe(false);
  });

  it('extracts single named parameter', () => {
    const r = route('GET', '/api/agents/:id', noop);
    const match = '/api/agents/abc-123'.match(r.pattern);
    expect(match).not.toBeNull();
    expect(match!.groups!.id).toBe('abc-123');
  });

  it('extracts multiple named parameters', () => {
    const r = route('GET', '/api/agents/:id/runs/:runId', noop);
    const match = '/api/agents/agent-1/runs/run-2'.match(r.pattern);
    expect(match).not.toBeNull();
    expect(match!.groups!.id).toBe('agent-1');
    expect(match!.groups!.runId).toBe('run-2');
  });

  it('extracts three nested parameters', () => {
    const r = route('DELETE', '/api/agents/:id/runs/:runId/messages/:messageId', noop);
    const match = '/api/agents/a/runs/b/messages/c'.match(r.pattern);
    expect(match).not.toBeNull();
    expect(match!.groups!.id).toBe('a');
    expect(match!.groups!.runId).toBe('b');
    expect(match!.groups!.messageId).toBe('c');
  });

  it('does not match params with slashes', () => {
    const r = route('GET', '/api/agents/:id', noop);
    expect(r.pattern.test('/api/agents/a/b')).toBe(false);
  });
});

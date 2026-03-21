import { describe, it, expect } from 'vitest';
import { parseSchedule, validateSchedule, describeSchedule, getNextRuns } from '../../../src/daemon/scheduler.js';

describe('parseSchedule', () => {
  it('returns standard cron expressions as-is', () => {
    expect(parseSchedule('*/5 * * * *')).toBe('*/5 * * * *');
    expect(parseSchedule('0 9 * * 1')).toBe('0 9 * * 1');
  });

  it('trims and lowercases input', () => {
    expect(parseSchedule('  Every 5 Minutes  ')).toBe('*/5 * * * *');
  });

  describe('shorthands', () => {
    it('every minute', () => expect(parseSchedule('every minute')).toBe('* * * * *'));
    it('every 5 minutes', () => expect(parseSchedule('every 5 minutes')).toBe('*/5 * * * *'));
    it('every 10 minutes', () => expect(parseSchedule('every 10 minutes')).toBe('*/10 * * * *'));
    it('every 15 minutes', () => expect(parseSchedule('every 15 minutes')).toBe('*/15 * * * *'));
    it('every 30 minutes', () => expect(parseSchedule('every 30 minutes')).toBe('*/30 * * * *'));
    it('every hour', () => expect(parseSchedule('every hour')).toBe('0 * * * *'));
    it('every 2 hours', () => expect(parseSchedule('every 2 hours')).toBe('0 */2 * * *'));
    it('daily', () => expect(parseSchedule('daily')).toBe('0 9 * * *'));
    it('daily at midnight', () => expect(parseSchedule('daily at midnight')).toBe('0 0 * * *'));
    it('weekly', () => expect(parseSchedule('weekly')).toBe('0 9 * * 1'));
    it('monthly', () => expect(parseSchedule('monthly')).toBe('0 9 1 * *'));
    it('hourly', () => expect(parseSchedule('hourly')).toBe('0 * * * *'));
  });

  describe('compact forms', () => {
    it('every 5m', () => expect(parseSchedule('every 5m')).toBe('*/5 * * * *'));
    it('every 2h', () => expect(parseSchedule('every 2h')).toBe('0 */2 * * *'));
    it('every 3d', () => expect(parseSchedule('every 3d')).toBe('0 9 */3 * *'));
    it('every 10 mins', () => expect(parseSchedule('every 10 mins')).toBe('*/10 * * * *'));
    it('every 1 hour', () => expect(parseSchedule('every 1 hour')).toBe('0 */1 * * *'));
    it('every 7 days', () => expect(parseSchedule('every 7 days')).toBe('0 9 */7 * *'));
  });

  describe('daily at time', () => {
    it('daily at 9:30 am', () => expect(parseSchedule('daily at 9:30 am')).toBe('30 9 * * *'));
    it('daily at 2:30pm', () => expect(parseSchedule('daily at 2:30pm')).toBe('30 14 * * *'));
    it('daily at 14:00', () => expect(parseSchedule('daily at 14:00')).toBe('0 14 * * *'));
    it('daily at 12:00 am (midnight)', () => expect(parseSchedule('daily at 12:00 am')).toBe('0 0 * * *'));
    it('daily at 12:00 pm (noon)', () => expect(parseSchedule('daily at 12:00 pm')).toBe('0 12 * * *'));
  });
});

describe('validateSchedule', () => {
  it('returns parsed cron for valid input', () => {
    expect(validateSchedule('every 5 minutes')).toBe('*/5 * * * *');
    expect(validateSchedule('0 9 * * 1')).toBe('0 9 * * 1');
  });

  it('throws on invalid cron expression', () => {
    expect(() => validateSchedule('not a schedule')).toThrow();
    expect(() => validateSchedule('* * * *')).toThrow(); // too few fields
  });
});

describe('describeSchedule', () => {
  it('returns human-readable description', () => {
    const desc = describeSchedule('*/5 * * * *');
    expect(desc.toLowerCase()).toContain('5');
    expect(desc.toLowerCase()).toContain('minute');
  });

  it('returns raw expression on invalid input', () => {
    expect(describeSchedule('invalid')).toBe('invalid');
  });
});

describe('getNextRuns', () => {
  it('returns the requested number of future dates', () => {
    const runs = getNextRuns('* * * * *', 3);
    expect(runs).toHaveLength(3);
    for (const run of runs) {
      expect(run).toBeInstanceOf(Date);
      expect(run.getTime()).toBeGreaterThan(Date.now());
    }
  });

  it('returns dates in ascending order', () => {
    const runs = getNextRuns('*/5 * * * *', 5);
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i].getTime()).toBeGreaterThan(runs[i - 1].getTime());
    }
  });

  it('returns empty array for invalid expression', () => {
    expect(getNextRuns('invalid', 3)).toEqual([]);
  });

  it('defaults to 1 run', () => {
    const runs = getNextRuns('* * * * *');
    expect(runs).toHaveLength(1);
  });
});

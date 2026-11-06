import { describe, expect, test } from 'bun:test';

import { formatUtcInTimeZone, nowUtc, parseUtcIso, toUtcIso } from './index';

describe('time facade', () => {
  test('nowUtc produces a UTC ISO string', () => {
    expect(nowUtc()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test('toUtcIso/parseUtcIso round-trip', () => {
    const date = new Date('2026-07-02T12:34:56.789Z');
    expect(parseUtcIso(toUtcIso(date)).getTime()).toBe(date.getTime());
  });

  test('parseUtcIso rejects garbage', () => {
    expect(() => parseUtcIso('not-a-date')).toThrow(TypeError);
  });

  test('formatUtcInTimeZone converts at the boundary', () => {
    const iso = toUtcIso(new Date('2026-01-01T00:30:00.000Z'));
    // 00:30 UTC = 09:30 in Seoul (UTC+9) — even on New Year's day.
    const seoul = formatUtcInTimeZone(iso, { timeZone: 'Asia/Seoul', locale: 'en-US' });
    expect(seoul).toContain('Jan 1, 2026');
    expect(seoul).toContain('9:30');
  });

  test('formatUtcInTimeZone keeps zones and locales apart across calls', () => {
    const iso = toUtcIso(new Date('2026-01-01T00:30:00.000Z'));
    const seoul = { timeZone: 'Asia/Seoul', locale: 'en-US' };
    const utc = { timeZone: 'UTC', locale: 'en-US' };
    expect(formatUtcInTimeZone(iso, seoul)).toContain('9:30');
    expect(formatUtcInTimeZone(iso, utc)).toContain('12:30');
    expect(formatUtcInTimeZone(iso, seoul)).toContain('9:30');
    expect(formatUtcInTimeZone(iso, { ...seoul, locale: 'ko-KR' })).toContain('2026. 1. 1.');
    expect(() => formatUtcInTimeZone(iso, { timeZone: 'Not/AZone' })).toThrow(RangeError);
  });
});

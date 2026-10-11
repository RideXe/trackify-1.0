import { describe, expect, it } from 'vitest';
import { calendarDay, defaultOfflineAfterMs, offlineAfterMs, staleSortKey } from '../src/activity';

describe('when a tracker counts as offline', () => {
  it('allows two missed syncs plus a minute, never less than five minutes', () => {
    expect(offlineAfterMs()).toBe(300_000);
    expect(offlineAfterMs(30)).toBe(300_000);
    expect(offlineAfterMs(120)).toBe(300_000);
    // A 5-minute interval used to flip to offline between every upload.
    expect(offlineAfterMs(300)).toBe(660_000);
  });

  it('keeps the sweeper’s fixed cutoff working for every interval', () => {
    const seen = 1_760_000_000_000;
    // The sweeper marks offline once staleSk < now − 5 min.
    const offlineAt = (interval?: number) => staleSortKey(seen, interval) + defaultOfflineAfterMs;
    expect(offlineAt()).toBe(seen + 300_000);
    expect(offlineAt(300)).toBe(seen + 660_000);
    // Records written before allowances existed stored staleSk = last seen: unchanged meaning.
    expect(staleSortKey(seen)).toBe(seen);
  });
});

describe('which day a trip counts on', () => {
  it('uses India time by default, not UTC', () => {
    // 1:00 AM on 12 Oct in India is still 11 Oct in UTC.
    const lateNight = Date.UTC(2026, 9, 11, 19, 30);
    expect(new Date(lateNight).toISOString().slice(0, 10)).toBe('2026-10-11');
    expect(calendarDay(lateNight)).toBe('2026-10-12');
    expect(calendarDay(lateNight, 'Europe/London')).toBe('2026-10-11');
  });

  it('falls back to India time for an unknown zone instead of failing', () => {
    expect(calendarDay(Date.UTC(2026, 9, 11, 19, 30), 'Not/AZone')).toBe('2026-10-12');
  });
});

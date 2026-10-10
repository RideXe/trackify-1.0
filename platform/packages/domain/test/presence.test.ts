import { describe, expect, it } from 'vitest';
import { defaultOfflineAfterMs, offlineAfterMs, staleSortKey } from '../src/activity';

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

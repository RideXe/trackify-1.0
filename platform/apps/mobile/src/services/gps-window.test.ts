import { beforeEach, describe, expect, it, vi } from 'vitest';
const { values } = vi.hoisted(() => ({ values: new Map<string, string>() }));
vi.mock('./secure-store', () => ({
  getItemAsync: (key: string) => Promise.resolve(values.get(key) ?? null),
  setItemAsync: (key: string, value: string) => {
    values.set(key, value);
    return Promise.resolve();
  },
  deleteItemAsync: (key: string) => {
    values.delete(key);
    return Promise.resolve();
  },
}));
import { describeWindow, filterGpsWindow, parseWindow, resetGpsFilter } from './gps-window';

const fix = (second: number, extra = {}) => ({
  t: 1_760_000_000_000 + second * 1000,
  e: second * 1000,
  lat: 12.9716 + (second * 15) / 111_195,
  lon: 77.5946,
  acc: 5,
  spd: 15,
  spdAcc: 0.3,
  brg: 0,
  ...extra,
});

beforeEach(() => values.clear());

describe('GPS windows on the phone', () => {
  it('parses the native window and ignores malformed fixes', () => {
    expect(parseWindow(JSON.stringify([fix(0), { lat: 1 }, 'x']))).toHaveLength(1);
    expect(parseWindow('not json')).toEqual([]);
    expect(parseWindow(undefined)).toEqual([]);
  });

  it('keeps the filter’s memory between windows, so a spike at the edge is still caught', async () => {
    const first = Array.from({ length: 30 }, (_, second) => fix(second));
    first[29] = fix(29, { lat: 12.99, acc: 8 }); // 2 km off at the window edge
    await filterGpsWindow(first, false);
    const second = await filterGpsWindow(
      Array.from({ length: 30 }, (_, index) => fix(30 + index)),
      false,
    );
    expect(second.report.rejected.spike).toBe(1);
    expect(second.points.every((point) => Math.abs(point.lat - 12.99) > 0.01)).toBe(true);
  });

  it('forgets the old position after a reset', async () => {
    await filterGpsWindow([fix(0), fix(1)], true);
    await resetGpsFilter();
    const fresh = await filterGpsWindow([fix(3000, { lat: 13.5 })], true);
    expect(fresh.points).toHaveLength(1);
  });

  it('writes a readable log line when something was dropped', async () => {
    const window = Array.from({ length: 30 }, (_, second) => fix(second));
    window[10] = fix(10, { acc: 400 });
    window[11] = fix(11, { mock: true });
    const { report } = await filterGpsWindow(window, false);
    expect(describeWindow(report)).toMatch(
      /^GPS: 30 fixes, \d+ sent, 2 dropped \(poor accuracy 1, fake GPS 1\), \d+ m$/,
    );
    const clean = await filterGpsWindow(
      Array.from({ length: 30 }, (_, second) => fix(30 + second)),
      false,
    );
    expect(describeWindow(clean.report)).toBeUndefined();
  });
});

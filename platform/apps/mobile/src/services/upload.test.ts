import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CleanPoint, FilterReport } from '@trackify/geo';
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
import { batchBody, checkIn, uploadBatch } from './upload';
import {
  defaultTrackerConfig,
  readPendingPositions,
  readSyncStatus,
  appendPendingPosition,
  readTrackerLogs,
} from './storage';
const config = {
  ...defaultTrackerConfig,
  deviceId: 'car-1',
  uniqueId: 'phone-1',
  endpoint: 'https://api.example/phone/positions',
  credential: 'test-credential',
};
const point = (t: number): CleanPoint => ({
  t,
  lat: 12.9,
  lon: 77.5,
  acc: 4,
  spd: 0,
  still: true,
  path: 0,
});
const report: FilterReport = {
  raw: 30,
  kept: 28,
  uploaded: 1,
  rejected: { inaccurate: 2 },
  relocations: 0,
  recovered: 0,
  samples: [],
  distanceM: 0,
};
const upload = (t = 1000) => uploadBatch(config, [point(t)], report);
beforeEach(() => {
  values.clear();
  vi.unstubAllGlobals();
});
describe('phone uploads', () => {
  it('sends a filtered window with what the filter dropped', () => {
    expect(JSON.parse(batchBody(config, [point(1000)], report, 80))).toEqual({
      v: 2,
      id: 'phone-1',
      batt: 80,
      int: 30,
      points: [point(1000)],
      filter: {
        raw: 30,
        kept: 28,
        uploaded: 1,
        rejected: { inaccurate: 2 },
        relocations: 0,
        distanceM: 0,
        samples: [],
      },
    });
  });
  it('checks in without positions, after sending what was saved offline', async () => {
    await upload(1000).catch(() => undefined); // no fetch stubbed: saved offline
    expect(await readSyncStatus()).toMatchObject({ problem: 'offline' });
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal('fetch', fetch);
    await checkIn(config, 'no-gps', report);
    const bodies = fetch.mock.calls.map(
      (call) => JSON.parse((call[1] as { body: string }).body) as { points: CleanPoint[] },
    );
    expect(bodies.map((body) => body.points.length)).toEqual([1, 0]);
    expect(await readPendingPositions()).toHaveLength(0);
    const status = await readSyncStatus();
    expect(status.problem).toBe('no-gps');
    expect(status.positionsAt).toBeGreaterThan(0);
    expect(status.contactAt).toBeGreaterThanOrEqual(status.positionsAt!);
  });
  it('a paused check-in is not a GPS problem; positions clear any problem', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 202 }));
    await checkIn(config, 'paused');
    expect((await readSyncStatus()).problem).toBeUndefined();
    await checkIn(config, 'no-gps');
    await upload();
    expect((await readSyncStatus()).problem).toBeUndefined();
  });
  it('records a refused phone as an access problem for the driver to see', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 403, json: () => Promise.resolve({}) }),
    );
    await expect(checkIn(config, 'no-gps')).rejects.toThrow('Check-in failed');
    expect((await readSyncStatus()).problem).toBe('access');
  });
  it('persists offline readings, replays in order, then removes acknowledged fixes', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal('fetch', fetch);
    await expect(upload(1000)).rejects.toThrow('offline');
    expect(await readPendingPositions()).toHaveLength(1);
    await upload(2000);
    expect(
      fetch.mock.calls
        .slice(1)
        .map(
          (call) =>
            (JSON.parse((call[1] as { body: string }).body) as { points: CleanPoint[] }).points[0]
              .t,
        ),
    ).toEqual([1000, 2000]);
    expect(await readPendingPositions()).toHaveLength(0);
  });
  it('keeps rejected credentials pending and never reports a successful upload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(upload()).rejects.toThrow('access');
    expect(await readPendingPositions()).toHaveLength(1);
  });
  it('drops a reading the server rejects, records why, and does not report it uploaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ message: 'lat is invalid' }),
      }),
    );
    await upload();
    expect(await readPendingPositions()).toHaveLength(0);
    const logs = await readTrackerLogs();
    expect(logs.some((line) => line.endsWith('GPS reading rejected: lat is invalid'))).toBe(true);
    expect(logs.some((line) => line.includes('uploaded'))).toBe(false);
  });
  it('never sends a previous vehicle reading using the current credential', async () => {
    await appendPendingPosition({ deviceId: 'old-car', endpoint: config.endpoint, body: '{}' });
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal('fetch', fetch);
    await upload();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      (JSON.parse((fetch.mock.calls[0][1] as { body: string }).body) as { id: string }).id,
    ).toBe('phone-1');
  });
  it('bounds offline retention to the newest 120 readings', async () => {
    for (let i = 0; i < 125; i++)
      await appendPendingPosition({
        deviceId: 'car-1',
        endpoint: config.endpoint,
        body: String(i),
      });
    const items = await readPendingPositions();
    expect(items).toHaveLength(120);
    expect(items[0].body).toBe('5');
    expect(items[119].body).toBe('124');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocationFix } from '../native/location';
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
import { uploadLocation, positionBody } from './upload';
import {
  defaultTrackerConfig,
  readPendingPositions,
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
const location = {
  timestamp: 1000,
  coords: {
    latitude: 12.9,
    longitude: 77.5,
    altitude: null,
    speed: -1,
    heading: -1,
    accuracy: null,
    altitudeAccuracy: null,
  },
} as LocationFix;
beforeEach(() => {
  values.clear();
  vi.unstubAllGlobals();
});
describe('phone uploads', () => {
  it('omits unavailable optional GPS fields while preserving stationary coordinates', () => {
    expect(JSON.parse(positionBody(config, location))).toEqual({
      id: 'phone-1',
      lat: 12.9,
      lon: 77.5,
      timestamp: 1000,
    });
  });
  it('persists offline readings, replays in order, then removes acknowledged fixes', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal('fetch', fetch);
    await expect(uploadLocation(config, location)).rejects.toThrow('offline');
    expect(await readPendingPositions()).toHaveLength(1);
    await uploadLocation(config, { ...location, timestamp: 2000 });
    expect(
      fetch.mock.calls
        .slice(1)
        .map(
          (call) =>
            (JSON.parse((call[1] as { body: string }).body) as { timestamp: number }).timestamp,
        ),
    ).toEqual([1000, 2000]);
    expect(await readPendingPositions()).toHaveLength(0);
  });
  it('keeps rejected credentials pending and never reports a successful upload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(uploadLocation(config, location)).rejects.toThrow('access');
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
    await uploadLocation(config, location);
    expect(await readPendingPositions()).toHaveLength(0);
    const logs = await readTrackerLogs();
    expect(logs.some((line) => line.endsWith('GPS reading rejected: lat is invalid'))).toBe(true);
    expect(logs.some((line) => line.includes('uploaded'))).toBe(false);
  });
  it('never sends a previous vehicle reading using the current credential', async () => {
    await appendPendingPosition({ deviceId: 'old-car', endpoint: config.endpoint, body: '{}' });
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal('fetch', fetch);
    await uploadLocation(config, location);
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

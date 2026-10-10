import { describe, expect, it } from 'vitest';
import {
  downsample,
  geofenceVisits,
  localTime,
  stops,
  summarise,
  toCsv,
  tripRows,
} from '../src/index';

const MIN = 60_000;
const trip = (start: number, end: number, distanceM = 10_000) => ({
  tripId: `t${start}`,
  startTime: start * MIN,
  endTime: end * MIN,
  distanceM,
  maxSpeedKmh: 60,
  startLatitude: 1,
  startLongitude: 2,
  endLatitude: start + 0.5,
  endLongitude: 3,
});

describe('trips and stops', () => {
  it('adds duration and average speed in time order', () => {
    const rows = tripRows([trip(60, 90, 20_000), trip(0, 30)]);
    expect(rows.map((row) => row.tripId)).toEqual(['t0', 't60']);
    expect(rows[1]).toMatchObject({ durationMs: 30 * MIN, averageSpeedKmh: 40 });
  });

  it('finds stops between trips where the earlier trip ended', () => {
    const result = stops([trip(0, 30), trip(60, 90), trip(91, 120)], {
      to: 200 * MIN,
      now: 300 * MIN,
    });
    expect(result).toEqual([
      { startTime: 30 * MIN, endTime: 60 * MIN, durationMs: 30 * MIN, latitude: 0.5, longitude: 3 },
      {
        startTime: 120 * MIN,
        endTime: 200 * MIN,
        durationMs: 80 * MIN,
        latitude: 91.5,
        longitude: 3,
      },
    ]);
  });

  it('leaves the last stop open while the vehicle is still parked', () => {
    const [last] = stops([trip(0, 30)], { to: 100 * MIN, now: 50 * MIN });
    expect(last).toMatchObject({ startTime: 30 * MIN, endTime: undefined, durationMs: 20 * MIN });
  });
});

describe('geofence visits', () => {
  it('pairs enters with exits per geofence, keeping open and pre-existing visits', () => {
    const visits = geofenceVisits(
      [
        { type: 'geofenceExit', eventTime: 5, geofenceId: 'yard' },
        { type: 'geofenceEnter', eventTime: 10, geofenceId: 'depot' },
        { type: 'geofenceEnter', eventTime: 12, geofenceId: 'yard' },
        { type: 'geofenceExit', eventTime: 20, geofenceId: 'depot' },
        { type: 'ignitionOn', eventTime: 21 },
      ],
      100,
    );
    expect(visits).toEqual([
      { geofenceId: 'yard', enterTime: undefined, exitTime: 5, durationMs: undefined },
      { geofenceId: 'depot', enterTime: 10, exitTime: 20, durationMs: 10 },
      { geofenceId: 'yard', enterTime: 12, durationMs: 88 },
    ]);
  });
});

describe('summary', () => {
  it('adds up days and keeps the top speed', () => {
    expect(
      summarise([
        { sk: '2026-10-11', distanceM: 1000, tripCount: 2, maxSpeedKmh: 70 },
        { sk: '2026-10-12', distanceM: 500, tripCount: 1, maxSpeedKmh: 90 },
      ]),
    ).toEqual({ days: 2, distanceM: 1500, tripCount: 3, movingTimeS: 0, maxSpeedKmh: 90 });
  });
});

describe('CSV', () => {
  it('quotes, escapes and defuses spreadsheet formulas', () => {
    const csv = toCsv(
      [
        { name: '=HYPERLINK("x")', note: 'a, "b"', speed: 42 },
        { name: 'Van', note: undefined, speed: 0 },
      ],
      [
        { header: 'Vehicle', value: (row) => row.name },
        { header: 'Note', value: (row) => row.note },
        { header: 'Speed', value: (row) => row.speed },
      ],
    );
    expect(csv).toBe('﻿Vehicle,Note,Speed\r\n"\'=HYPERLINK(""x"")","a, ""b""",42\r\nVan,,0\r\n');
  });

  it('writes times in the fleet’s zone', () => {
    expect(localTime(Date.parse('2026-10-12T04:30:00Z'), 'Asia/Kolkata')).toBe(
      '2026-10-12 10:00:00',
    );
  });
});

describe('downsampling', () => {
  it('keeps the ends and the peaks', () => {
    const points = Array.from({ length: 1_000 }, (_, index) => ({
      time: index,
      value: index === 500 ? 120 : 40,
    }));
    const sampled = downsample(points, 50);
    expect(sampled).toHaveLength(50);
    expect(sampled[0]?.time).toBe(0);
    expect(sampled.at(-1)?.time).toBe(999);
    expect(sampled.some((point) => point.value === 120)).toBe(true);
  });

  it('returns short series unchanged', () => {
    expect(downsample([{ time: 1, value: 1 }], 10)).toEqual([{ time: 1, value: 1 }]);
  });
});

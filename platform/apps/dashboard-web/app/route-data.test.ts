import type { StoredPosition } from '@trackify/api-client';
import { describe, expect, it } from 'vitest';
import {
  MAX_ROUTE_POINTS,
  PAGE_SIZE,
  loadRoute,
  routeFileName,
  routeToCsv,
  routeToGpx,
  routeToKml,
  summarizeRoute,
  withoutDrift,
} from './route-data';

function fix(fixTime: number, extra: Partial<StoredPosition> = {}): StoredPosition {
  return {
    fixTime,
    messageId: `m-${fixTime}-${extra.messageId ?? ''}`,
    valid: true,
    latitude: 12.9,
    longitude: 77.5,
    ...extra,
  };
}

/** Behaves like GET /devices/{id}/positions: inclusive range, newest first, capped at `limit`. */
function positionsApi(fixes: StoredPosition[]) {
  const calls: Array<[number, number]> = [];
  const fetchPage = (from: number, to: number, limit: number) => {
    calls.push([from, to]);
    return Promise.resolve(
      fixes
        .filter((item) => item.fixTime >= from && item.fixTime <= to)
        .sort((a, b) => b.fixTime - a.fixTime)
        .slice(0, limit),
    );
  };
  return { fetchPage, calls };
}

describe('loadRoute', () => {
  it('returns one page oldest first and leaves out fixes without a GPS lock', async () => {
    const { fetchPage, calls } = positionsApi([
      fix(3000),
      fix(1000),
      fix(2000, { valid: false }),
      fix(9999),
    ]);
    const route = await loadRoute(fetchPage, 0, 5000);
    expect(route.points.map((point) => point.fixTime)).toEqual([1000, 3000]);
    expect(route.skipped).toBe(1);
    expect(route.truncated).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('pages backwards past the API limit without losing or repeating fixes', async () => {
    const all = Array.from({ length: 12_345 }, (_, index) => fix(1_000 + index * 1_000));
    const { fetchPage, calls } = positionsApi(all);
    const route = await loadRoute(fetchPage, 0, Number.MAX_SAFE_INTEGER);
    expect(route.points).toHaveLength(12_345);
    expect(new Set(route.points.map((point) => point.fixTime)).size).toBe(12_345);
    expect(route.points[0]?.fixTime).toBe(1_000);
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it('keeps fixes that share the millisecond where two pages meet', async () => {
    // The first page's oldest fix has a twin at the same millisecond that did not fit in it.
    const newest = Array.from({ length: PAGE_SIZE - 1 }, (_, index) => fix(10_000 + index));
    const boundary = [fix(9_000, { messageId: 'a' }), fix(9_000, { messageId: 'b' })];
    const { fetchPage } = positionsApi([...newest, ...boundary, fix(5_000)]);
    const route = await loadRoute(fetchPage, 0, 1_000_000);
    expect(route.points).toHaveLength(PAGE_SIZE + 2);
    expect(route.points.filter((point) => point.fixTime === 9_000)).toHaveLength(2);
  });

  it('stops at the point cap and says the oldest part was not loaded', async () => {
    const all = Array.from({ length: MAX_ROUTE_POINTS + PAGE_SIZE + 10 }, (_, index) =>
      fix(index + 1),
    );
    const { fetchPage } = positionsApi(all);
    const route = await loadRoute(fetchPage, 0, Number.MAX_SAFE_INTEGER);
    expect(route.truncated).toBe(true);
    expect(route.points.length).toBeGreaterThanOrEqual(MAX_ROUTE_POINTS);
    expect(route.points.at(-1)?.fixTime).toBe(all.length);
  });
});

describe('summarizeRoute', () => {
  it('adds up distance, duration and top speed', () => {
    const summary = summarizeRoute([
      { fixTime: 0, latitude: 0, longitude: 0, speedKmh: 20 },
      { fixTime: 60_000, latitude: 0, longitude: 1, speedKmh: 55 },
    ]);
    expect(summary.distanceM / 1000).toBeCloseTo(111.2, 1);
    expect(summary.durationMs).toBe(60_000);
    expect(summary.maxSpeedKmh).toBe(55);
  });

  it('handles an empty route', () => {
    expect(summarizeRoute([])).toEqual({ distanceM: 0, durationMs: 0, maxSpeedKmh: 0 });
  });
});

describe('route downloads', () => {
  const points = [
    { fixTime: Date.UTC(2026, 8, 26, 4, 0), latitude: 12.97, longitude: 77.59, altitudeM: 920 },
    { fixTime: Date.UTC(2026, 8, 26, 4, 5), latitude: 12.98, longitude: 77.6, speedKmh: 42.5 },
  ];

  it('writes KML with longitude,latitude order, start/end markers and an escaped name', () => {
    const kml = routeToKml('Van <12> & co', points);
    expect(kml).toContain('<name>Van &lt;12&gt; &amp; co</name>');
    expect(kml).toContain('<coordinates>77.59,12.97 77.6,12.98</coordinates>');
    expect(kml).toContain('<name>Start</name><TimeStamp><when>2026-09-26T04:00:00.000Z</when>');
    expect(kml).toContain('<name>End</name>');
  });

  it('writes GPX track points with time and optional elevation', () => {
    const gpx = routeToGpx('Van 12', points);
    expect(gpx).toContain(
      '<trkpt lat="12.97" lon="77.59"><ele>920</ele><time>2026-09-26T04:00:00.000Z</time></trkpt>',
    );
    expect(gpx).toContain(
      '<trkpt lat="12.98" lon="77.6"><time>2026-09-26T04:05:00.000Z</time></trkpt>',
    );
  });

  it('writes CSV with a header and empty cells for missing values', () => {
    expect(routeToCsv(points).split('\r\n')).toEqual([
      'time_utc,latitude,longitude,speed_kmh,course_deg,altitude_m,accuracy_m',
      '2026-09-26T04:00:00.000Z,12.97,77.59,,,920,',
      '2026-09-26T04:05:00.000Z,12.98,77.6,42.5,,,',
      '',
    ]);
  });

  it('names files after the vehicle and period', () => {
    expect(routeFileName('Van #12 (North)', 0, 0, 'gpx')).toMatch(
      /^van-12-north-route-\d{4}-\d{2}-\d{2}-\d{4}-to-\d{4}-\d{2}-\d{2}-\d{4}\.gpx$/,
    );
    expect(routeFileName('***', 0, 0, 'kml')).toMatch(/^vehicle-route-/);
  });
});

describe('GPS drift in route history', () => {
  const metresNorth = (metres: number) => 12.9335805 + metres / 111_195;
  // A phone parked indoors for 8 hours: readings wander up to ~120 m with ~80 m accuracy.
  const parkedDay = [0, 60, -40, 90, 10, -70, 120, -20].map((metres, index) => ({
    fixTime: index * 3_600_000,
    latitude: metresNorth(metres),
    longitude: 77.5362201,
    accuracyM: 80,
    speedKmh: 11,
  }));

  it('draws a parked vehicle as one point and adds no distance or speed', () => {
    expect(withoutDrift(parkedDay)).toHaveLength(1);
    expect(summarizeRoute(parkedDay)).toEqual({
      distanceM: 0,
      durationMs: 7 * 3_600_000,
      maxSpeedKmh: 0,
    });
  });

  it('keeps a real drive after the parked period', () => {
    const drive = [500, 1_000, 1_500].map((metres, index) => ({
      fixTime: 8 * 3_600_000 + (index + 1) * 60_000,
      latitude: metresNorth(metres),
      longitude: 77.5362201,
      accuracyM: 6,
      speedKmh: 30,
    }));
    const route = withoutDrift([...parkedDay, ...drive]);
    expect(route).toHaveLength(4);
    expect(summarizeRoute([...parkedDay, ...drive]).distanceM / 1000).toBeCloseTo(1.5, 1);
  });
});

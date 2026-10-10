import { describe, expect, it } from 'vitest';
import {
  crossTrackMeters,
  distanceMeters,
  filterWindow,
  initialFilterState,
  type CleanPoint,
  type FilterState,
  type RawFix,
} from '../src/index';

/** A drive with known truth: positions in metres from an origin in Bengaluru, 1 fix per second. */
const ORIGIN = { lat: 12.9716, lon: 77.5946 };
const M_PER_DEG_LAT = 111_195;
const mPerDegLon = M_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);
const at = (east: number, north: number) => ({
  lat: ORIGIN.lat + north / M_PER_DEG_LAT,
  lon: ORIGIN.lon + east / mPerDegLon,
});

/** Deterministic noise, so failures reproduce. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31;
    return state / 2 ** 31;
  };
}
function gaussian(next: () => number) {
  return Math.sqrt(-2 * Math.log(next() || 1e-9)) * Math.cos(2 * Math.PI * next());
}

interface Truth {
  t: number;
  east: number;
  north: number;
  speed: number;
  bearing: number;
}

/** 15 m/s north for 60 s, a right turn, then 15 m/s east for 60 s. */
function lShapedDrive(): Truth[] {
  const truth: Truth[] = [];
  for (let second = 0; second <= 120; second += 1) {
    const north = Math.min(second, 60) * 15;
    const east = Math.max(second - 60, 0) * 15;
    truth.push({
      t: 1_760_000_000_000 + second * 1000,
      east,
      north,
      speed: 15,
      bearing: second < 60 ? 0 : 90,
    });
  }
  return truth;
}

function observe(truth: Truth[], seed = 7, noiseM = 4): RawFix[] {
  const next = random(seed);
  return truth.map((point) => ({
    t: point.t,
    e: point.t - 1_759_999_000_000,
    ...at(point.east + gaussian(next) * noiseM, point.north + gaussian(next) * noiseM),
    acc: 5,
    spd: Math.max(0, point.speed + gaussian(next) * 0.2),
    spdAcc: 0.3,
    brg: point.bearing,
  }));
}

function run(fixes: RawFix[], windowSize = 30, overrides = {}) {
  let state: FilterState = initialFilterState();
  const points: CleanPoint[] = [];
  const reports = [];
  for (let index = 0; index < fixes.length; index += windowSize) {
    const window = fixes.slice(index, index + windowSize);
    const final = index + windowSize >= fixes.length;
    const result = filterWindow(window, state, overrides, final);
    state = JSON.parse(JSON.stringify(result.state)) as FilterState; // as persisted on the phone
    points.push(...result.points);
    reports.push(result.report);
  }
  const rejected: Record<string, number> = {};
  for (const report of reports)
    for (const [reason, count] of Object.entries(report.rejected))
      rejected[reason] = (rejected[reason] ?? 0) + (count ?? 0);
  return {
    points,
    state,
    rejected,
    distance: points.reduce((sum, point) => sum + point.path, 0),
    relocations: reports.reduce((sum, report) => sum + report.relocations, 0),
  };
}

/** Distance from the true route (the L) for an output point. */
function errorFromRoute(point: { lat: number; lon: number }) {
  const corner = at(0, 900);
  return Math.min(
    crossTrackMeters(at(0, 0), corner, point),
    crossTrackMeters(corner, at(900, 900), point),
  );
}

describe('track filter on a clean drive', () => {
  it('keeps distance within 2% of the truth and every point on the road', () => {
    const { points, distance, rejected } = run(observe(lShapedDrive()));
    expect(Math.abs(distance - 1800) / 1800).toBeLessThan(0.02);
    expect(Math.max(...points.map(errorFromRoute))).toBeLessThan(8);
    expect(Object.values(rejected).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(3);
  });

  it('uploads a fraction of the fixes while keeping the turn', () => {
    const { points } = run(observe(lShapedDrive()));
    expect(points.length).toBeLessThan(121 * 0.3);
    const corner = at(0, 900);
    expect(
      Math.min(
        ...points.map((point) =>
          distanceMeters(
            { latitude: point.lat, longitude: point.lon },
            { latitude: corner.lat, longitude: corner.lon },
          ),
        ),
      ),
    ).toBeLessThan(20);
    // Never more than 10 s between uploaded points while driving.
    for (let index = 1; index < points.length; index += 1)
      expect(points[index]!.t - points[index - 1]!.t).toBeLessThanOrEqual(10_000);
  });

  it('gives the same result whether fixes arrive in 30 s windows or 10 s windows', () => {
    const fixes = observe(lShapedDrive());
    const a = run(fixes, 30);
    const b = run(fixes, 10);
    expect(Math.abs(a.distance - b.distance)).toBeLessThan(18);
  });
});

describe('noise the filter removes', () => {
  it('drops a one-second spike that comes straight back (look-ahead)', () => {
    const fixes = observe(lShapedDrive());
    fixes[30] = { ...fixes[30]!, ...at(300, 450), acc: 8 };
    const { points, rejected, distance } = run(fixes);
    expect(rejected.spike ?? 0).toBeGreaterThanOrEqual(1);
    expect(Math.max(...points.map(errorFromRoute))).toBeLessThan(8);
    expect(Math.abs(distance - 1800) / 1800).toBeLessThan(0.02);
  });

  it('drops Wi-Fi and cell-tower fallbacks by their accuracy', () => {
    const fixes = observe(lShapedDrive());
    for (let index = 40; index < 46; index += 1)
      fixes[index] = {
        ...fixes[index]!,
        ...at(-700, 300),
        acc: 450,
        spd: undefined,
        brg: undefined,
      };
    const { points, rejected } = run(fixes);
    expect(rejected.inaccurate).toBe(6);
    expect(Math.max(...points.map(errorFromRoute))).toBeLessThan(8);
  });

  it('drops a multipath jump the receiver’s own Doppler speed contradicts', () => {
    const fixes = observe(lShapedDrive());
    // 70 m ahead in one second while the receiver measures 15 m/s, then 2 more far-off fixes.
    for (let index = 20; index < 22; index += 1)
      fixes[index] = { ...fixes[index]!, ...at(0, index * 15 + 70) };
    const { rejected, points } = run(fixes);
    expect(
      (rejected.speedMismatch ?? 0) +
        (rejected.tooFast ?? 0) +
        (rejected.spike ?? 0) +
        (rejected.inconsistent ?? 0),
    ).toBeGreaterThanOrEqual(2);
    expect(Math.max(...points.map(errorFromRoute))).toBeLessThan(8);
  });

  it('rejects mock locations', () => {
    const fixes = observe(lShapedDrive()).map((fix, index) =>
      index % 10 === 5 ? { ...fix, mock: true } : fix,
    );
    expect(run(fixes).rejected.mock).toBe(12);
  });

  it('holds a parked vehicle still despite indoor drift', () => {
    const next = random(3);
    const parked: RawFix[] = Array.from({ length: 300 }, (_, second) => ({
      t: 1_760_000_000_000 + second * 1000,
      ...at(gaussian(next) * 15, gaussian(next) * 15),
      acc: 20,
      spd: Math.abs(gaussian(next) * 0.2),
    }));
    const { points, distance } = run(parked);
    expect(distance).toBeLessThan(5);
    expect(points.every((point, index) => index === 0 || point.still)).toBe(true);
    expect(points.length).toBeLessThanOrEqual(8);
  });
});

describe('real jumps the filter must keep', () => {
  it('restarts after a tunnel and continues from the exit', () => {
    const truth = lShapedDrive();
    const fixes = observe(truth).filter((_, index) => index < 20 || index > 95);
    const { points } = run(fixes);
    expect(points.at(-1)!.lon).toBeCloseTo(at(900, 900).lon, 3);
    expect(Math.max(...points.map(errorFromRoute))).toBeLessThan(8);
  });

  it('accepts a run of fixes that agree with each other after a jump, as a relocation', () => {
    const fixes = observe(lShapedDrive()).slice(0, 40);
    // GPS was stuck on an old position; the next fixes are consistently 2 km away.
    for (let index = 25; index < 40; index += 1)
      fixes[index] = { ...fixes[index]!, ...at(2000, 2000 + (index - 25) * 15) };
    const { points, relocations } = run(fixes);
    expect(relocations).toBe(1);
    expect(points.at(-1)!.lat).toBeCloseTo(at(2000, 2000 + 14 * 15).lat, 3);
  });
});

describe('state between windows', () => {
  it('holds the last fix for look-ahead and releases it on the final window', () => {
    const fixes = observe(lShapedDrive()).slice(0, 5);
    const first = filterWindow(fixes, initialFilterState());
    expect(first.state.pending?.t).toBe(fixes[4]!.t);
    const flushed = filterWindow([], first.state, {}, true);
    expect(flushed.points.at(-1)?.t).toBe(fixes[4]!.t);
  });

  it('survives being saved as JSON', () => {
    const { state } = run(observe(lShapedDrive()).slice(0, 50));
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('reports what it did, for debugging', () => {
    const fixes = observe(lShapedDrive()).slice(0, 30);
    fixes[10] = { ...fixes[10]!, acc: 300 };
    const { report } = filterWindow(fixes, initialFilterState());
    expect(report).toMatchObject({ raw: 30, rejected: { inaccurate: 1 } });
    expect(report.samples[0]).toMatchObject({ reason: 'inaccurate', acc: 300 });
    expect(report.kept + 1 + 1).toBe(30); // one rejected, one held back
  });
});

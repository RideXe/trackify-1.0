import { describe, expect, it } from 'vitest';
import { contains, distanceMeters, movedBeyondDrift, plausibleDistance } from '../src/index';

describe('geo calculations', () => {
  it('calculates short road-scale distances', () => {
    expect(
      distanceMeters(
        { latitude: 12.9716, longitude: 77.5946 },
        { latitude: 12.9726, longitude: 77.5946 },
      ),
    ).toBeCloseTo(111.2, 0);
  });

  it('supports circle and polygon geofences', () => {
    const point = { latitude: 12.9716, longitude: 77.5946 };
    expect(contains({ type: 'circle', center: point, radiusM: 100 }, point)).toBe(true);
    expect(
      contains(
        {
          type: 'polygon',
          points: [
            { latitude: 12.97, longitude: 77.59 },
            { latitude: 12.98, longitude: 77.59 },
            { latitude: 12.98, longitude: 77.6 },
            { latitude: 12.97, longitude: 77.6 },
          ],
        },
        point,
      ),
    ).toBe(true);
  });

  it('drops impossible jumps from distance accumulation', () => {
    expect(
      plausibleDistance(
        { latitude: 0, longitude: 0, fixTime: 0 },
        { latitude: 1, longitude: 1, fixTime: 1_000 },
      ),
    ).toBe(0);
  });
});

describe('GPS drift', () => {
  const parked = { latitude: 12.9335805, longitude: 77.5362201 };
  // About 0.0001 degree of latitude is 11 m.
  const north = (metres: number) => ({ ...parked, latitude: parked.latitude + metres / 111_195 });

  it('ignores wander inside the reported accuracy of an indoor phone', () => {
    expect(movedBeyondDrift({ ...parked, accuracyM: 82 }, { ...north(120), accuracyM: 73 })).toBe(
      false,
    );
  });

  it('counts a move beyond both accuracy radii', () => {
    expect(movedBeyondDrift({ ...parked, accuracyM: 8 }, { ...north(60), accuracyM: 6 })).toBe(
      true,
    );
  });

  it('applies a minimum for trackers that do not report accuracy', () => {
    expect(movedBeyondDrift(parked, north(20))).toBe(false);
    expect(movedBeyondDrift(parked, north(30))).toBe(true);
  });
});

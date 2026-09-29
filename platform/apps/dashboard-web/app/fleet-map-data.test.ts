import type { Device } from '@trackify/api-client';
import { describe, expect, it } from 'vitest';
import {
  fleetBounds,
  fleetFeatures,
  headingLabel,
  hoverRows,
  statusCounts,
  timeAgo,
  vehicleStatus,
} from './fleet-map-data';

const now = 1_800_000_000_000;

function vehicle(id: string, state: Device['state'], extra: Partial<Device> = {}): Device {
  return {
    deviceId: id,
    name: `Vehicle ${id}`,
    uniqueId: `u-${id}`,
    protocol: 'osmand',
    groupId: 'UNGROUPED',
    state,
    ...extra,
  };
}

const at = { latitude: 12.97, longitude: 77.59 };

describe('vehicle status', () => {
  it('is offline without a recent update, or when the server says so', () => {
    expect(vehicleStatus(vehicle('a', undefined), now)).toBe('offline');
    expect(vehicleStatus(vehicle('a', { ...at, lastSeenAt: now - 300_000 }), now)).toBe('offline');
    expect(vehicleStatus(vehicle('a', { lastSeenAt: now, status: 'offline' }), now)).toBe(
      'offline',
    );
  });

  it("follows the server's motion decision, with speed as the fallback", () => {
    expect(vehicleStatus(vehicle('a', { lastSeenAt: now, motion: true }), now)).toBe('moving');
    expect(vehicleStatus(vehicle('a', { lastSeenAt: now, motion: false, speedKmh: 11 }), now)).toBe(
      'parked',
    );
    expect(vehicleStatus(vehicle('a', { lastSeenAt: now, speedKmh: 30 }), now)).toBe('moving');
    expect(vehicleStatus(vehicle('a', { lastSeenAt: now, speedKmh: 1 }), now)).toBe('parked');
  });
});

describe('fleet features', () => {
  it('puts every positioned vehicle on the map with its type icon in the status colour', () => {
    const { features } = fleetFeatures(
      [
        vehicle(
          'bus',
          {
            ...at,
            lastSeenAt: now,
            motion: true,
            speedKmh: 42.4,
            courseDeg: 90,
            odometerM: 12_345,
            trip: { startTime: now - 600_000, distanceM: 3_200, maxSpeedKmh: 51.6 },
          },
          { vehicleType: 'schoolBus' },
        ),
        vehicle('parked', { ...at, lastSeenAt: now, motion: false, speedKmh: 9 }),
        vehicle('no-gps', { lastSeenAt: now }),
      ],
      now,
    );
    expect(features.map((feature) => feature.properties.deviceId)).toEqual(['bus', 'parked']);
    expect(features[0]?.geometry.coordinates).toEqual([77.59, 12.97]);
    expect(features[0]?.properties).toMatchObject({
      vehicleType: 'schoolBus',
      status: 'moving',
      icon: 'vehicle-schoolBus-moving',
      heading: 90,
      speedKmh: 42,
      odometerKm: 12.345,
      tripKm: 3.2,
      tripTopKmh: 52,
    });
    // Older vehicles without a type are cars, and a parked vehicle shows no drift speed.
    expect(features[1]?.properties).toMatchObject({
      vehicleType: 'car',
      icon: 'vehicle-car-parked',
      speedKmh: 0,
    });
    expect(features[1]?.properties.tripKm).toBeUndefined();
  });

  it('bounds the whole fleet, and nothing for an empty map', () => {
    const { features } = fleetFeatures(
      [
        vehicle('a', { latitude: 12.9, longitude: 77.5, lastSeenAt: now }),
        vehicle('b', { latitude: 28.6, longitude: 77.2, lastSeenAt: now }),
        vehicle('c', { latitude: 19.0, longitude: 72.8, lastSeenAt: now }),
      ],
      now,
    );
    expect(fleetBounds(features)).toEqual([
      [72.8, 12.9],
      [77.5, 28.6],
    ]);
    expect(fleetBounds([])).toBeUndefined();
  });

  it('counts vehicles by status for the legend', () => {
    expect(
      statusCounts(
        [
          vehicle('a', { lastSeenAt: now, motion: true }),
          vehicle('b', { lastSeenAt: now, motion: false }),
          vehicle('c', undefined),
        ],
        now,
      ),
    ).toEqual({ moving: 1, parked: 1, offline: 1 });
  });
});

describe('hover card', () => {
  it('shows speed, trip, total distance and last update for a moving vehicle', () => {
    const [bus] = fleetFeatures(
      [
        vehicle('bus', {
          ...at,
          lastSeenAt: now - 120_000,
          motion: true,
          speedKmh: 42,
          courseDeg: 50,
          odometerM: 1_234_567,
          trip: { startTime: now, distanceM: 3_250, maxSpeedKmh: 51 },
        }),
      ],
      now,
    ).features;
    expect(hoverRows(bus!.properties, now)).toEqual([
      ['Status', 'Moving'],
      ['Speed now', '42 km/h'],
      ['Heading', 'NE'],
      ['This trip', '3.3 km · top 51 km/h'],
      ['Total distance', '1,234.6 km'],
      ['Last update', '2 min ago'],
    ]);
  });

  it('names compass directions and elapsed time', () => {
    expect([0, 44, 90, 200, 359, -90].map(headingLabel)).toEqual(['N', 'NE', 'E', 'S', 'N', 'W']);
    expect([10_000, 300_000, 7_200_000, 86_400_000].map((ago) => timeAgo(now - ago, now))).toEqual([
      'just now',
      '5 min ago',
      '2 h ago',
      '1 day ago',
    ]);
  });
});

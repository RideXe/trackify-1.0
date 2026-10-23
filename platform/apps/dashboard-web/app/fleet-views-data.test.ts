import type { Device, FleetTrip } from '@trackify/api-client';
import { describe, expect, it } from 'vitest';
import {
  durationLabel,
  overviewCounts,
  overviewVehicles,
  tripTotals,
  tripsCsv,
} from './fleet-views-data';

const now = 1_800_000_000_000;
const vehicle = (id: string, extra: Partial<Device> = {}): Device => ({
  deviceId: id,
  name: `Vehicle ${id}`,
  uniqueId: `gps-${id}`,
  protocol: 'osmand',
  groupId: 'UNGROUPED',
  ...extra,
});
const trip = (extra: Partial<FleetTrip>): FleetTrip => ({
  tripId: 't',
  deviceId: 'd',
  deviceName: 'Van',
  startTime: 0,
  endTime: 30 * 60_000,
  distanceM: 12_000,
  maxSpeedKmh: 60,
  startLatitude: 12.9,
  startLongitude: 77.5,
  endLatitude: 13,
  endLongitude: 77.6,
  ...extra,
});

describe('trips', () => {
  it('totals distance, driving time and top speed', () => {
    expect(tripTotals([trip({}), trip({ maxSpeedKmh: 80, distanceM: 3_000 })])).toEqual({
      count: 2,
      distanceM: 15_000,
      drivingMs: 60 * 60_000,
      maxSpeedKmh: 80,
    });
    expect(durationLabel(90 * 60_000)).toBe('1 h 30 min');
  });

  it('writes a CSV that spreadsheets cannot mistake for formulas', () => {
    const csv = tripsCsv([trip({ deviceName: '=HYPERLINK("x")' })]);
    const [header, row] = csv.split('\r\n');
    expect(header).toContain('"Distance (km)"');
    expect(row).toMatch(/^"'=HYPERLINK\(""x""\)"/);
    expect(row).toContain('"12.00"');
    expect(tripsCsv([trip({ startLatitude: -12.5 })])).toContain('"-12.5"');
  });
});

describe('overview tiles', () => {
  const at = { latitude: 12.97, longitude: 77.59 };
  const seen = (msAgo: number, extra: Partial<Device['state']> = {}) => ({
    ...at,
    status: 'online',
    lastSeenAt: now - msAgo,
    fixTime: now - msAgo,
    ...extra,
  });
  const cars = [
    vehicle('b-parked', { name: 'Bravo', state: seen(60_000) }),
    vehicle('a-offline', { name: 'Alpha', state: seen(3_600_000) }),
    vehicle('c-moving', { name: 'Charlie', state: seen(30_000, { motion: true, speedKmh: 40 }) }),
    // On shift, silent for 20 minutes: the phone cannot be reached.
    vehicle('d-silent', { name: 'Delta', dutyStatus: 'on', state: seen(1_200_000) }),
    vehicle('e-alert', { name: 'Echo', state: seen(60_000) }),
  ];
  const alerts = new Set(['e-alert']);

  it('counts each tile, with unreachable phones and open alerts as needing attention', () => {
    expect(overviewCounts(cars, alerts, now)).toEqual({
      all: 5,
      moving: 1,
      parked: 2,
      offline: 2,
      attention: 2,
    });
  });

  it('lists vehicles needing attention first, then moving, parked and offline', () => {
    expect(overviewVehicles(cars, 'all', '', alerts, now).map((car) => car.name)).toEqual([
      'Delta',
      'Echo',
      'Charlie',
      'Bravo',
      'Alpha',
    ]);
  });

  it('filters by the clicked tile and by the search box', () => {
    expect(overviewVehicles(cars, 'attention', '', alerts, now).map((car) => car.name)).toEqual([
      'Delta',
      'Echo',
    ]);
    expect(overviewVehicles(cars, 'all', 'char', alerts, now).map((car) => car.name)).toEqual([
      'Charlie',
    ]);
    // GPS numbers too, whatever the case.
    expect(overviewVehicles(cars, 'all', 'GPS-B', alerts, now).map((car) => car.name)).toEqual([
      'Bravo',
    ]);
  });
});

import type { Device, FleetTrip } from '@trackify/api-client';
import { describe, expect, it } from 'vitest';
import {
  durationLabel,
  filterCounts,
  filterVehicles,
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
const fleet = [
  vehicle('b', { state: { lastSeenAt: now, motion: true } }),
  vehicle('a', { state: { lastSeenAt: now, motion: false }, dutyStatus: 'paused' }),
  vehicle('c', { dutyStatus: 'on', state: { lastSeenAt: now - 3_600_000 } }),
];

describe('live map filters', () => {
  it('filters by status, shift and search, sorted by name', () => {
    expect(filterVehicles(fleet, 'all', '', now).map((d) => d.deviceId)).toEqual(['a', 'b', 'c']);
    expect(filterVehicles(fleet, 'moving', '', now).map((d) => d.deviceId)).toEqual(['b']);
    expect(filterVehicles(fleet, 'on-shift', '', now).map((d) => d.deviceId)).toEqual(['a', 'c']);
    expect(filterVehicles(fleet, 'not-reporting', '', now).map((d) => d.deviceId)).toEqual(['c']);
    expect(filterVehicles(fleet, 'all', 'GPS-B', now).map((d) => d.deviceId)).toEqual(['b']);
  });

  it('counts every filter', () => {
    expect(filterCounts(fleet, now)).toEqual({
      all: 3,
      moving: 1,
      parked: 1,
      offline: 1,
      'on-shift': 2,
      'not-reporting': 1,
    });
  });
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

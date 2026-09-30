import type { Device, FleetTrip } from '@trackify/api-client';
import { notReporting } from './driver-activity-data';
import { vehicleStatus } from './fleet-map-data';

export const liveFilters = {
  all: 'All',
  moving: 'Moving',
  parked: 'Parked',
  offline: 'Offline',
  'on-shift': 'On shift',
  'not-reporting': 'Not reporting',
} as const;
export type LiveFilter = keyof typeof liveFilters;

/** Vehicles matching a status filter and a name / GPS id search, in name order. */
export function filterVehicles(
  devices: Device[],
  filter: LiveFilter,
  query: string,
  now = Date.now(),
): Device[] {
  const needle = query.trim().toLowerCase();
  return devices
    .filter((device) => {
      if (filter === 'on-shift' && device.dutyStatus !== 'on' && device.dutyStatus !== 'paused')
        return false;
      if (filter === 'not-reporting' && !notReporting(device, now)) return false;
      if (
        (filter === 'moving' || filter === 'parked' || filter === 'offline') &&
        vehicleStatus(device, now) !== filter
      )
        return false;
      return (
        !needle ||
        device.name.toLowerCase().includes(needle) ||
        device.uniqueId.toLowerCase().includes(needle)
      );
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function filterCounts(devices: Device[], now = Date.now()): Record<LiveFilter, number> {
  const counts = Object.fromEntries(Object.keys(liveFilters).map((key) => [key, 0])) as Record<
    LiveFilter,
    number
  >;
  for (const filter of Object.keys(liveFilters) as LiveFilter[])
    counts[filter] = filterVehicles(devices, filter, '', now).length;
  return counts;
}

export function tripTotals(trips: FleetTrip[]) {
  let distanceM = 0;
  let drivingMs = 0;
  let maxSpeedKmh = 0;
  for (const trip of trips) {
    distanceM += trip.distanceM;
    drivingMs += Math.max(0, trip.endTime - trip.startTime);
    maxSpeedKmh = Math.max(maxSpeedKmh, trip.maxSpeedKmh);
  }
  return { count: trips.length, distanceM, drivingMs, maxSpeedKmh };
}

export function durationLabel(ms: number) {
  const minutes = Math.round(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}

/**
 * Spreadsheet-safe: every field quoted, and text starting with = + - @ neutralised so a vehicle
 * name cannot run as a formula. Numbers are left alone: -12.5 is a latitude, not a formula.
 */
function csvField(value: string | number) {
  const text = String(value);
  const safe = typeof value === 'string' && /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function tripsCsv(trips: FleetTrip[]) {
  const header = [
    'Vehicle',
    'Start',
    'End',
    'Duration (min)',
    'Distance (km)',
    'Top speed (km/h)',
    'Start latitude',
    'Start longitude',
    'End latitude',
    'End longitude',
  ];
  const rows = trips.map((trip) => [
    trip.deviceName ?? trip.deviceId,
    new Date(trip.startTime).toLocaleString('en-IN'),
    new Date(trip.endTime).toLocaleString('en-IN'),
    Math.round((trip.endTime - trip.startTime) / 60_000),
    (trip.distanceM / 1000).toFixed(2),
    Math.round(trip.maxSpeedKmh),
    trip.startLatitude,
    trip.startLongitude,
    trip.endLatitude,
    trip.endLongitude,
  ]);
  return [header, ...rows].map((row) => row.map(csvField).join(',')).join('\r\n');
}

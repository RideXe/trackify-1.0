import type { Device, FleetTrip } from '@trackify/api-client';
import { notReporting } from './driver-activity-data';
import { vehicleStatus } from './fleet-map-data';

/** The Overview's and Live map's filters; each one filters the map and the vehicle list. */
export const overviewFilters = {
  all: 'Total',
  moving: 'Moving',
  parked: 'Parked',
  offline: 'Offline',
  attention: 'Alerts',
} as const;
export type OverviewFilter = keyof typeof overviewFilters;

/** Someone should act: a driver on shift whose phone cannot be reached, or an open alert. */
export function needsAttention(
  device: Device,
  openAlertDeviceIds: ReadonlySet<string>,
  now = Date.now(),
) {
  return notReporting(device, now) || openAlertDeviceIds.has(device.deviceId);
}

const overviewRank = { attention: 0, moving: 1, parked: 2, offline: 3 };

/**
 * Vehicles for the Overview: filtered by a tile and a name / GPS id search, with the ones that
 * need attention first, then moving, parked and offline, each by name.
 */
export function overviewVehicles(
  devices: Device[],
  filter: OverviewFilter,
  query: string,
  openAlertDeviceIds: ReadonlySet<string>,
  now = Date.now(),
): Device[] {
  const needle = query.trim().toLowerCase();
  const rank = (device: Device) =>
    needsAttention(device, openAlertDeviceIds, now)
      ? overviewRank.attention
      : overviewRank[vehicleStatus(device, now)];
  return devices
    .filter((device) => {
      if (filter === 'attention' && !needsAttention(device, openAlertDeviceIds, now)) return false;
      if (filter !== 'all' && filter !== 'attention' && vehicleStatus(device, now) !== filter)
        return false;
      return (
        !needle ||
        device.name.toLowerCase().includes(needle) ||
        device.uniqueId.toLowerCase().includes(needle)
      );
    })
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export function overviewCounts(
  devices: Device[],
  openAlertDeviceIds: ReadonlySet<string>,
  now = Date.now(),
): Record<OverviewFilter, number> {
  const counts = { all: 0, moving: 0, parked: 0, offline: 0, attention: 0 };
  for (const filter of Object.keys(counts) as OverviewFilter[])
    counts[filter] = overviewVehicles(devices, filter, '', openAlertDeviceIds, now).length;
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

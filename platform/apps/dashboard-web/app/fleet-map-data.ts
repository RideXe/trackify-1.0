import { toVehicleType, type Device, type VehicleType } from '@trackify/api-client';

export type VehicleStatus = 'moving' | 'parked' | 'offline';

/** Same rule as the rest of the dashboard: no update for five minutes means offline. */
export const OFFLINE_AFTER_MS = 300_000;

export const statusColors: Record<VehicleStatus, string> = {
  moving: '#155EEF',
  parked: '#079455',
  offline: '#98A2B3',
};

export const statusLabels: Record<VehicleStatus, string> = {
  moving: 'Moving',
  parked: 'Parked',
  offline: 'Offline',
};

export function vehicleStatus(device: Device, now = Date.now()): VehicleStatus {
  const state = device.state;
  const seen = state?.lastSeenAt;
  if (!seen || now - seen >= OFFLINE_AFTER_MS || state?.status === 'offline') return 'offline';
  // The server decides motion with GPS drift filtered out; speed is the fallback for old records.
  return (state?.motion ?? (state?.speedKmh ?? 0) >= 3) ? 'moving' : 'parked';
}

export const vehicleIconId = (type: VehicleType, status: VehicleStatus) =>
  `vehicle-${type}-${status}`;

/** Flat values only: map features carry primitives, not nested objects. */
export interface VehicleProperties {
  deviceId: string;
  name: string;
  vehicleType: VehicleType;
  status: VehicleStatus;
  icon: string;
  heading: number;
  speedKmh: number;
  odometerKm: number;
  lastSeenAt?: number;
  tripKm?: number;
  tripTopKmh?: number;
}

export interface VehicleFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: VehicleProperties;
}

export interface FleetCollection {
  type: 'FeatureCollection';
  features: VehicleFeature[];
}

/** Every vehicle with a known position, as map features. */
export function fleetFeatures(devices: Device[], now = Date.now()): FleetCollection {
  const features: VehicleFeature[] = [];
  for (const device of devices) {
    const state = device.state;
    const latitude = state?.latitude;
    const longitude = state?.longitude;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    const vehicleType = toVehicleType(device.vehicleType);
    const status = vehicleStatus(device, now);
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [longitude!, latitude!] },
      properties: {
        deviceId: device.deviceId,
        name: device.name,
        vehicleType,
        status,
        icon: vehicleIconId(vehicleType, status),
        heading: state?.courseDeg ?? 0,
        speedKmh: status === 'moving' ? Math.round(state?.speedKmh ?? 0) : 0,
        odometerKm: (state?.odometerM ?? 0) / 1000,
        ...(state?.lastSeenAt ? { lastSeenAt: state.lastSeenAt } : {}),
        ...(state?.trip
          ? { tripKm: state.trip.distanceM / 1000, tripTopKmh: Math.round(state.trip.maxSpeedKmh) }
          : {}),
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

/** South-west and north-east corners around every vehicle, or undefined for an empty map. */
export function fleetBounds(
  features: VehicleFeature[],
): [[number, number], [number, number]] | undefined {
  if (!features.length) return undefined;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const { geometry } of features) {
    const [longitude, latitude] = geometry.coordinates;
    west = Math.min(west, longitude);
    east = Math.max(east, longitude);
    south = Math.min(south, latitude);
    north = Math.max(north, latitude);
  }
  return [
    [west, south],
    [east, north],
  ];
}

export function statusCounts(devices: Device[], now = Date.now()) {
  const counts: Record<VehicleStatus, number> = { moving: 0, parked: 0, offline: 0 };
  for (const device of devices) counts[vehicleStatus(device, now)] += 1;
  return counts;
}

const compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function headingLabel(degrees: number) {
  return compass[Math.round((((degrees % 360) + 360) % 360) / 45) % 8]!;
}

export function timeAgo(ms: number, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - ms) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

const km = (value: number) => `${value.toLocaleString('en-IN', { maximumFractionDigits: 1 })} km`;

/** What the hover card shows, as label/value rows. */
export function hoverRows(vehicle: VehicleProperties, now = Date.now()): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ['Status', statusLabels[vehicle.status]],
    ['Speed now', `${vehicle.speedKmh} km/h`],
  ];
  if (vehicle.status === 'moving') rows.push(['Heading', headingLabel(vehicle.heading)]);
  if (vehicle.tripKm !== undefined)
    rows.push(['This trip', `${km(vehicle.tripKm)} · top ${vehicle.tripTopKmh ?? 0} km/h`]);
  rows.push(['Total distance', km(vehicle.odometerKm)]);
  if (vehicle.lastSeenAt) rows.push(['Last update', timeAgo(vehicle.lastSeenAt, now)]);
  return rows;
}

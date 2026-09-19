import { createHash } from 'node:crypto';
import type { EventMessage, EventType, PositionMessage } from '@trackify/domain';
import { contains, distanceMeters, plausibleDistance, type GeofenceShape } from '@trackify/geo';

export interface GeofenceRule {
  id: string;
  shape: GeofenceShape;
}
export interface FleetRules {
  speedLimitKmh?: number;
  geofences: GeofenceRule[];
}
export interface FleetState {
  fixTime: number;
  latitude: number;
  longitude: number;
  motion: boolean;
  ignition?: boolean;
  overspeeding: boolean;
  geofencesInside: string[];
  odometerM: number;
  trip?: {
    tripId: string;
    startTime: number;
    startLatitude: number;
    startLongitude: number;
    distanceM: number;
    maxSpeedKmh: number;
  };
}
export interface CompletedTrip {
  tripId: string;
  startTime: number;
  endTime: number;
  distanceM: number;
  maxSpeedKmh: number;
  startLatitude: number;
  startLongitude: number;
  endLatitude: number;
  endLongitude: number;
}
export interface FleetTransition {
  state: FleetState;
  events: EventMessage[];
  completedTrip?: CompletedTrip;
}

/** Reject fixes that belong in history but must not move live state or affect trips. */
export function isPlausibleLiveFix(
  previous: Pick<FleetState, 'fixTime' | 'latitude' | 'longitude'> | undefined,
  position: PositionMessage,
): boolean {
  if (!position.valid || (position.latitude === 0 && position.longitude === 0)) return false;
  if (!previous) return true;
  const distance = distanceMeters(previous, position);
  return distance === 0 || plausibleDistance(previous, position) > 0;
}

export function evaluatePosition(
  previous: FleetState | undefined,
  position: PositionMessage,
  rules: FleetRules,
): FleetTransition {
  const motion = position.attributes.motion ?? (position.speedKmh ?? 0) >= 3;
  const ignition = position.attributes.ignition;
  const segmentM = previous
    ? plausibleDistance(
        { latitude: previous.latitude, longitude: previous.longitude, fixTime: previous.fixTime },
        position,
      )
    : 0;
  const inside = rules.geofences
    .filter((rule) => contains(rule.shape, position))
    .map((rule) => rule.id)
    .sort();
  const overspeeding =
    rules.speedLimitKmh !== undefined && (position.speedKmh ?? 0) > rules.speedLimitKmh;
  const events: EventMessage[] = [];
  const emit = (type: EventType, extra: Partial<EventMessage> = {}) =>
    events.push({
      v: 1,
      eventId: deterministicId(position.deviceId, type, position.fixTime, extra.geofenceId ?? ''),
      tenantId: position.tenantId,
      deviceId: position.deviceId,
      type,
      eventTime: position.fixTime,
      positionFixTime: position.fixTime,
      attributes: {},
      ...extra,
    });

  if (!previous) emit('deviceOnline');
  if (previous && motion !== previous.motion) emit(motion ? 'deviceMoving' : 'deviceStopped');
  if (previous && ignition !== undefined && ignition !== previous.ignition)
    emit(ignition ? 'ignitionOn' : 'ignitionOff');
  if (overspeeding && !previous?.overspeeding) emit('deviceOverspeed');
  for (const geofenceId of inside.filter((id) => !previous?.geofencesInside.includes(id)))
    emit('geofenceEnter', { geofenceId });
  for (const geofenceId of (previous?.geofencesInside ?? []).filter((id) => !inside.includes(id)))
    emit('geofenceExit', { geofenceId });
  for (const alarm of position.attributes.alarms ?? []) emit('alarm', { alarm });

  let trip = previous?.trip;
  let completedTrip: CompletedTrip | undefined;
  if (motion && !trip) {
    trip = {
      tripId: deterministicId(position.deviceId, 'trip', position.fixTime),
      startTime: position.fixTime,
      startLatitude: position.latitude,
      startLongitude: position.longitude,
      distanceM: 0,
      maxSpeedKmh: position.speedKmh ?? 0,
    };
    emit('tripStarted');
  } else if (motion && trip) {
    trip = {
      ...trip,
      distanceM: trip.distanceM + segmentM,
      maxSpeedKmh: Math.max(trip.maxSpeedKmh, position.speedKmh ?? 0),
    };
  } else if (!motion && trip) {
    completedTrip = {
      ...trip,
      endTime: position.fixTime,
      endLatitude: position.latitude,
      endLongitude: position.longitude,
      distanceM: trip.distanceM + segmentM,
    };
    trip = undefined;
    emit('tripEnded');
  }
  return {
    state: {
      fixTime: position.fixTime,
      latitude: position.latitude,
      longitude: position.longitude,
      motion,
      ignition,
      overspeeding,
      geofencesInside: inside,
      odometerM: (previous?.odometerM ?? 0) + segmentM,
      trip,
    },
    events,
    completedTrip,
  };
}

export function deterministicId(...parts: Array<string | number>): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const bytes = createHash('sha256').update(parts.join('|')).digest();
  let value = BigInt(`0x${bytes.subarray(0, 17).toString('hex')}`) >> 6n;
  let result = '';
  for (let index = 0; index < 26; index += 1) {
    result = alphabet[Number(value & 31n)] + result;
    value >>= 5n;
  }
  return result;
}

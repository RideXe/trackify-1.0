import { createHash } from 'node:crypto';
import type { EventMessage, EventType, PositionMessage } from '@trackify/domain';
import {
  contains,
  distanceMeters,
  movedBeyondDrift,
  plausibleDistance,
  type GeofenceShape,
} from '@trackify/geo';

export interface GeofenceRule {
  id: string;
  shape: GeofenceShape;
}
/** Another vehicle this one is linked to (a trailer, an escort), where it was last seen. */
export interface LinkedVehicle {
  deviceId: string;
  latitude: number;
  longitude: number;
}

/** Service due every `period` from `start`, in metres, engine seconds or epoch milliseconds. */
export interface MaintenanceRule {
  maintenanceId: string;
  name: string;
  type: 'odometerM' | 'engineHoursS' | 'fixTime';
  start: number;
  period: number;
}

export interface FleetRules {
  speedLimitKmh?: number;
  /** The driver assigned to the vehicle, recorded on speeding events. */
  driverId?: string;
  geofences: GeofenceRule[];
  /** Fuel level change, in percentage points, that raises a fuel event. Unset is off. */
  fuel?: { dropThreshold?: number; increaseThreshold?: number };
  /** Harsh driving, in m/s² between consecutive fixes. Unset is off. */
  behaviour?: { accelerationThresholdMs2?: number; brakingThresholdMs2?: number };
  proximity?: {
    enterDistanceM?: number;
    exitDistanceM?: number;
    /** Starting to move with no linked vehicle this close raises unaccompaniedMotion. */
    unaccompaniedDistanceM?: number;
    linked: LinkedVehicle[];
  };
  maintenances?: MaintenanceRule[];
}
export interface FleetState {
  /** Time of the latest reading, even when GPS drift kept the position below unchanged. */
  fixTime: number;
  /** Last accepted position; readings within GPS drift of it do not move the vehicle. */
  latitude: number;
  longitude: number;
  accuracyM?: number;
  /** Zero while the vehicle is not moving, so drift does not show as speed. */
  speedKmh?: number;
  motion: boolean;
  ignition?: boolean;
  overspeeding: boolean;
  /** The speeding episode in progress: when it began, how fast at most, under which limit. */
  overspeed?: {
    startTime: number;
    maxSpeedKmh: number;
    speedLimitKmh: number;
    latitude: number;
    longitude: number;
    driverId?: string;
  };
  geofencesInside: string[];
  odometerM: number;
  /** Engine running time: as reported by the tracker, or counted while ignition is on. */
  engineHoursS?: number;
  fuelLevelPct?: number;
  driverUniqueId?: string;
  trip?: {
    tripId: string;
    startTime: number;
    startLatitude: number;
    startLongitude: number;
    /** Filled in by processing when reverse geocoding is on. */
    startAddress?: string;
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
  startAddress?: string;
  endAddress?: string;
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

export interface EvaluateOptions {
  /** The fix was accepted as a genuine jump: no distance for the jump itself. */
  relocated?: boolean;
}

export function evaluatePosition(
  previous: FleetState | undefined,
  position: PositionMessage,
  rules: FleetRules,
  options: EvaluateOptions = {},
): FleetTransition {
  // A phone that filtered its own track says whether it moved and how far it drove; otherwise a
  // reading within GPS drift of the last accepted position is the same place: it keeps the
  // vehicle online but adds no distance and cannot start a trip on a noisy speed reading.
  const path = position.attributes.pathDistanceM;
  const filtered = path !== undefined && position.attributes.motion !== undefined;
  const moved =
    !previous ||
    (filtered ? position.attributes.motion === true : movedBeyondDrift(previous, position));
  const motion = position.attributes.motion ?? (moved && (position.speedKmh ?? 0) >= 3);
  const speedKmh = motion ? (position.speedKmh ?? 0) : 0;
  const ignition = position.attributes.ignition;
  const segmentM =
    previous && moved && !options.relocated ? segmentDistance(previous, position) : 0;
  // While parked, a clearly more accurate reading (at least twice as precise) may refine where
  // the vehicle is shown; marginally better readings would just make the dot wander again.
  const refines =
    previous !== undefined &&
    position.accuracyM !== undefined &&
    position.accuracyM <= (previous.accuracyM ?? Infinity) / 2;
  const located = !previous || moved || refines ? position : previous;
  const inside = rules.geofences
    .filter((rule) => contains(rule.shape, position))
    .map((rule) => rule.id)
    .sort();
  const overspeeding = rules.speedLimitKmh !== undefined && speedKmh > rules.speedLimitKmh;
  const events: EventMessage[] = [];
  // `key` keeps ids unique when one fix raises the same event type more than once.
  const emit = (type: EventType, extra: Partial<EventMessage> = {}, key = '') =>
    events.push({
      v: 1,
      eventId: deterministicId(
        position.deviceId,
        type,
        position.fixTime,
        extra.geofenceId ?? extra.alarm ?? key,
      ),
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
  // A speeding episode: the alert goes out as it starts; its top speed and length when it ends.
  let overspeed = previous?.overspeed;
  const driver: Record<string, string> = rules.driverId ? { driverId: rules.driverId } : {};
  if (overspeeding && !previous?.overspeeding) {
    overspeed = {
      startTime: position.fixTime,
      maxSpeedKmh: speedKmh,
      speedLimitKmh: rules.speedLimitKmh!,
      latitude: position.latitude,
      longitude: position.longitude,
      ...driver,
    };
    emit('deviceOverspeed', {
      attributes: {
        speedKmh: round1(speedKmh),
        speedLimitKmh: rules.speedLimitKmh!,
        ...driver,
      },
    });
  } else if (overspeeding && overspeed) {
    overspeed = { ...overspeed, maxSpeedKmh: Math.max(overspeed.maxSpeedKmh, speedKmh) };
  } else if (!overspeeding && previous?.overspeeding) {
    // Episodes that began before episodes were recorded have nothing to report.
    if (overspeed)
      emit('overspeedEnded', {
        attributes: {
          maxSpeedKmh: round1(overspeed.maxSpeedKmh),
          speedLimitKmh: overspeed.speedLimitKmh,
          startTime: overspeed.startTime,
          durationS: Math.max(0, Math.round((position.fixTime - overspeed.startTime) / 1000)),
          latitude: overspeed.latitude,
          longitude: overspeed.longitude,
          ...(overspeed.driverId && { driverId: overspeed.driverId }),
        },
      });
    overspeed = undefined;
  }
  for (const geofenceId of inside.filter((id) => !previous?.geofencesInside.includes(id)))
    emit('geofenceEnter', { geofenceId });
  // A geofence deleted while a vehicle was inside it is dropped silently, not reported as an exit.
  const exited = (previous?.geofencesInside ?? []).filter(
    (id) => !inside.includes(id) && rules.geofences.some((rule) => rule.id === id),
  );
  for (const geofenceId of exited) emit('geofenceExit', { geofenceId });
  for (const alarm of position.attributes.alarms ?? []) emit('alarm', { alarm });

  const odometerM = (previous?.odometerM ?? 0) + segmentM;
  const engineHoursS = engineHours(previous, position);
  const fuelLevelPct = position.attributes.fuelLevelPct ?? previous?.fuelLevelPct;
  const driverUniqueId = position.attributes.driverUniqueId ?? previous?.driverUniqueId;
  if (previous) {
    detectFuel(previous, position, rules, emit);
    detectBehaviour(previous, position, rules, emit);
    detectProximity(previous, position, rules, motion, emit);
    detectMaintenance(
      {
        odometerM: previous.odometerM,
        engineHoursS: previous.engineHoursS,
        fixTime: previous.fixTime,
      },
      { odometerM, engineHoursS, fixTime: position.fixTime },
      rules,
      emit,
    );
    const driver = position.attributes.driverUniqueId;
    if (driver !== undefined && driver !== previous.driverUniqueId)
      emit('driverChanged', { attributes: { driverUniqueId: driver } });
  }

  let trip = previous?.trip;
  let completedTrip: CompletedTrip | undefined;
  if (motion && !trip) {
    trip = {
      tripId: deterministicId(position.deviceId, 'trip', position.fixTime),
      startTime: position.fixTime,
      startLatitude: position.latitude,
      startLongitude: position.longitude,
      distanceM: 0,
      maxSpeedKmh: speedKmh,
    };
    emit('tripStarted');
  } else if (motion && trip) {
    trip = {
      ...trip,
      distanceM: trip.distanceM + segmentM,
      maxSpeedKmh: Math.max(trip.maxSpeedKmh, speedKmh),
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
      latitude: located.latitude,
      longitude: located.longitude,
      accuracyM: located.accuracyM,
      speedKmh,
      motion,
      ignition,
      overspeeding,
      ...(overspeed && { overspeed }),
      geofencesInside: inside,
      odometerM,
      engineHoursS,
      fuelLevelPct,
      driverUniqueId,
      trip,
    },
    events,
    completedTrip,
  };
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
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

export * from './computed';
export * from './expression';

type Emit = (type: EventType, extra?: Partial<EventMessage>, key?: string) => void;

/** A gap longer than this is lost signal, not engine running time. */
const MAX_ENGINE_GAP_MS = 15 * 60_000;

/** Counted while the ignition was on since the previous fix, unless the tracker reports it. */
function engineHours(previous: FleetState | undefined, position: PositionMessage) {
  const reported = position.attributes.engineHoursS;
  if (reported !== undefined) return reported;
  const base = previous?.engineHoursS;
  if (!previous || previous.ignition !== true) return base;
  const gap = position.fixTime - previous.fixTime;
  return gap > 0 && gap <= MAX_ENGINE_GAP_MS ? (base ?? 0) + gap / 1000 : base;
}

function detectFuel(
  previous: FleetState,
  position: PositionMessage,
  rules: FleetRules,
  emit: Emit,
) {
  const after = position.attributes.fuelLevelPct;
  const before = previous.fuelLevelPct;
  if (after === undefined || before === undefined || !rules.fuel) return;
  const change = after - before;
  const attributes = { before, after, fuelChange: `${Math.abs(change).toFixed(1)}%` };
  const { dropThreshold, increaseThreshold } = rules.fuel;
  if (change < 0 && dropThreshold && -change >= dropThreshold)
    emit('deviceFuelDrop', { attributes });
  if (change > 0 && increaseThreshold && change >= increaseThreshold)
    emit('deviceFuelIncrease', { attributes });
}

/** Speed change between consecutive fixes, as the legacy behaviour handler measured it. */
function detectBehaviour(
  previous: FleetState,
  position: PositionMessage,
  rules: FleetRules,
  emit: Emit,
) {
  const thresholds = rules.behaviour;
  const seconds = (position.fixTime - previous.fixTime) / 1000;
  if (!thresholds || seconds <= 0 || position.speedKmh === undefined) return;
  const acceleration = (position.speedKmh - (previous.speedKmh ?? 0)) / 3.6 / seconds;
  if (thresholds.accelerationThresholdMs2 && acceleration >= thresholds.accelerationThresholdMs2)
    emit('alarm', { alarm: 'hardAcceleration' });
  else if (thresholds.brakingThresholdMs2 && acceleration <= -thresholds.brakingThresholdMs2)
    emit('alarm', { alarm: 'hardBraking' });
}

function detectProximity(
  previous: FleetState,
  position: PositionMessage,
  rules: FleetRules,
  motion: boolean,
  emit: Emit,
) {
  const proximity = rules.proximity;
  if (!proximity?.linked.length) return;
  const { enterDistanceM = 0, exitDistanceM = 0, unaccompaniedDistanceM = 0 } = proximity;
  const checkUnaccompanied = unaccompaniedDistanceM > 0 && !previous.motion && motion;
  let accompanied = false;
  for (const linked of proximity.linked) {
    const now = distanceMeters(position, linked);
    const before = distanceMeters(previous, linked);
    const attributes = { linkedDeviceId: linked.deviceId };
    if (enterDistanceM > 0 && before > enterDistanceM && now <= enterDistanceM)
      emit('proximityEnter', { attributes }, linked.deviceId);
    else if (exitDistanceM > 0 && before <= exitDistanceM && now > exitDistanceM)
      emit('proximityExit', { attributes }, linked.deviceId);
    if (now <= unaccompaniedDistanceM) accompanied = true;
  }
  if (checkUnaccompanied && !accompanied) emit('unaccompaniedMotion');
}

/** Fires each time a service interval is crossed, as the legacy maintenance handler did. */
function detectMaintenance(
  before: Record<MaintenanceRule['type'], number | undefined>,
  after: Record<MaintenanceRule['type'], number | undefined>,
  rules: FleetRules,
  emit: Emit,
) {
  for (const rule of rules.maintenances ?? []) {
    const oldValue = before[rule.type];
    const newValue = after[rule.type];
    if (!rule.period || !oldValue || !newValue || newValue < rule.start) continue;
    const crossed =
      oldValue < rule.start ||
      Math.floor((oldValue - rule.start) / rule.period) <
        Math.floor((newValue - rule.start) / rule.period);
    if (crossed)
      emit(
        'maintenance',
        {
          attributes: {
            maintenanceId: rule.maintenanceId,
            maintenanceName: rule.name,
            [rule.type]: newValue,
          },
        },
        rule.maintenanceId,
      );
  }
}

/**
 * Distance for one step. The phone's along-track distance is more accurate than the straight
 * line (it follows curves between reported points), so it is used when it is plausible: not
 * shorter than the straight line allows, not absurdly longer, and not faster than possible.
 */
function segmentDistance(previous: FleetState, position: PositionMessage): number {
  const straight = plausibleDistance(
    { latitude: previous.latitude, longitude: previous.longitude, fixTime: previous.fixTime },
    position,
  );
  const path = position.attributes.pathDistanceM;
  if (path === undefined) return straight;
  const direct = distanceMeters(previous, position);
  const seconds = (position.fixTime - previous.fixTime) / 1000;
  const slack = (previous.accuracyM ?? 10) + (position.accuracyM ?? 10);
  const plausible =
    path >= direct - slack && path <= direct * 1.6 + 50 && (seconds <= 0 || path / seconds <= 83);
  return plausible ? path : straight;
}

export * from './fix-quality';

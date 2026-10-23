import type { PositionMessage, VehicleType } from '@trackify/domain';
import { distanceMeters, type GeoPoint } from '@trackify/geo';

/** Fastest plausible speed by vehicle type, m/s. Phones filter on the device too. */
const MAX_SPEED_MS: Partial<Record<VehicleType, number>> = {
  bus: 35,
  schoolBus: 30,
  truck: 35,
  tractor: 17,
  scooter: 28,
};
const DEFAULT_MAX_SPEED_MS = 50;

export function maxSpeedFor(vehicleType: unknown): number {
  return MAX_SPEED_MS[vehicleType as VehicleType] ?? DEFAULT_MAX_SPEED_MS;
}

/** A fix the server held out of the live track because it looked wrong. */
export interface Suspect {
  latitude: number;
  longitude: number;
  fixTime: number;
  count: number;
}

export type FixVerdict =
  { accept: true; relocated: boolean } | { accept: false; reason: string; suspect?: Suspect };

interface Previous extends GeoPoint {
  fixTime: number;
  accuracyM?: number;
  speedKmh?: number;
  suspect?: Suspect;
}

/** Consistent "impossible" fixes in a row that prove a real jump (tunnel exit, GPS restart). */
const RELOCATE_AFTER = 3;

/**
 * Server-side quality check for every position, most of all for hardware trackers, which cannot
 * filter on the device. Rejected fixes still go to history, tagged with the reason.
 */
export function assessFix(
  previous: Previous | undefined,
  position: PositionMessage,
  maxSpeedMs = DEFAULT_MAX_SPEED_MS,
): FixVerdict {
  if (!position.valid) return { accept: false, reason: 'invalid' };
  if (position.latitude === 0 && position.longitude === 0)
    return { accept: false, reason: 'invalid' };
  const satellites = position.attributes.satellites;
  if (satellites !== undefined && satellites > 0 && satellites < 4)
    return { accept: false, reason: 'fewSatellites' };
  const hdop = position.attributes.hdop;
  if (hdop !== undefined && hdop > 5) return { accept: false, reason: 'poorHdop' };
  if (position.accuracyM !== undefined && position.accuracyM > 100)
    return { accept: false, reason: 'inaccurate' };
  if (!previous) return { accept: true, relocated: false };

  const reason = implausible(previous, position, maxSpeedMs);
  if (!reason) return { accept: true, relocated: false };
  // Disagreeing with the past is not proof of being wrong: if the following fixes agree with
  // this one instead, the vehicle really is there.
  const suspect = previous.suspect;
  const agrees =
    suspect !== undefined &&
    position.fixTime > suspect.fixTime &&
    !implausible(
      { latitude: suspect.latitude, longitude: suspect.longitude, fixTime: suspect.fixTime },
      position,
      maxSpeedMs,
    );
  const count = agrees ? suspect.count + 1 : 1;
  if (count >= RELOCATE_AFTER) return { accept: true, relocated: true };
  return {
    accept: false,
    reason,
    suspect: {
      latitude: position.latitude,
      longitude: position.longitude,
      fixTime: position.fixTime,
      count,
    },
  };
}

function implausible(
  previous: Previous,
  position: PositionMessage,
  maxSpeedMs: number,
): string | undefined {
  const seconds = (position.fixTime - previous.fixTime) / 1000;
  if (seconds <= 0) return undefined;
  const distance = distanceMeters(previous, position);
  const slack = (previous.accuracyM ?? 10) + (position.accuracyM ?? 10);
  if ((distance - slack) / seconds > maxSpeedMs) return 'tooFast';
  // Tracker speed comes from the GPS chip's Doppler measurement. A jump much faster than both
  // readings is multipath or a stale position, not driving.
  const reported = Math.max(previous.speedKmh ?? -1, position.speedKmh ?? -1) / 3.6;
  if (reported >= 0 && seconds <= 60 && distance > slack + 20) {
    const implied = distance / seconds;
    if (implied > reported * 1.5 + 10 + (1.5 * slack) / seconds) return 'speedMismatch';
  }
  return undefined;
}

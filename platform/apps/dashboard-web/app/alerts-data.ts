import type { Device, FleetEvent } from '@trackify/api-client';

/** The alert rule the Speed limits tab manages; created with the first limit if missing. */
export const SPEED_RULE_NAME = 'Speed limit alerts';

/** One time a vehicle went over its limit: from its start event and, once over, its end event. */
export interface SpeedingEpisode {
  id: string;
  deviceId: string;
  deviceName: string;
  driverId?: string;
  speedLimitKmh?: number;
  maxSpeedKmh?: number;
  startTime: number;
  /** Unknown while it is still going on, or for episodes recorded before ends were. */
  durationS?: number;
  ongoing: boolean;
  latitude?: number;
  longitude?: number;
}

const number = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

/**
 * Speeding episodes, newest first. An ended episode carries its top speed and length; one still
 * going on takes its current top speed from the vehicle's live state.
 */
export function speedingEpisodes(events: FleetEvent[], devices: Device[]): SpeedingEpisode[] {
  const names = new Map(devices.map((device) => [device.deviceId, device.name]));
  const byDevice = new Map(devices.map((device) => [device.deviceId, device]));
  const episodes: SpeedingEpisode[] = [];
  const ended = new Set<string>();
  for (const event of events) {
    if (event.type !== 'overspeedEnded') continue;
    const startTime = number(event.attributes.startTime) ?? event.eventTime;
    ended.add(`${event.deviceId}|${startTime}`);
    episodes.push({
      id: event.eventId,
      deviceId: event.deviceId,
      deviceName: names.get(event.deviceId) ?? event.deviceName ?? 'Removed vehicle',
      driverId: text(event.attributes.driverId),
      speedLimitKmh: number(event.attributes.speedLimitKmh),
      maxSpeedKmh: number(event.attributes.maxSpeedKmh),
      startTime,
      durationS: number(event.attributes.durationS),
      ongoing: false,
      latitude: number(event.attributes.latitude),
      longitude: number(event.attributes.longitude),
    });
  }
  for (const event of events) {
    if (event.type !== 'deviceOverspeed' || ended.has(`${event.deviceId}|${event.eventTime}`))
      continue;
    const live = byDevice.get(event.deviceId)?.state;
    const ongoing = live?.overspeeding === true && live.overspeed?.startTime === event.eventTime;
    episodes.push({
      id: event.eventId,
      deviceId: event.deviceId,
      deviceName: names.get(event.deviceId) ?? event.deviceName ?? 'Removed vehicle',
      driverId: text(event.attributes.driverId),
      speedLimitKmh: number(event.attributes.speedLimitKmh),
      maxSpeedKmh: ongoing ? live.overspeed?.maxSpeedKmh : number(event.attributes.speedKmh),
      startTime: event.eventTime,
      ongoing,
    });
  }
  return episodes.sort((a, b) => b.startTime - a.startTime);
}

/** Vehicles over their limit right now, fastest first. */
export function speedingNow(devices: Device[]) {
  return devices
    .filter((device) => device.state?.overspeeding)
    .map((device) => ({
      device,
      speedKmh: Math.round(device.state?.speedKmh ?? 0),
      maxSpeedKmh: device.state?.overspeed?.maxSpeedKmh,
      speedLimitKmh: device.state?.overspeed?.speedLimitKmh ?? device.speedLimitKmh,
      since: device.state?.overspeed?.startTime,
      driverId: device.state?.overspeed?.driverId ?? device.driverId,
    }))
    .sort((a, b) => b.speedKmh - a.speedKmh);
}

/** A speed limit typed by an admin: whole km/h from 5 to 300, or undefined if not valid. */
export function parseSpeedLimit(value: string): number | undefined {
  const limit = Number(value.trim());
  return Number.isInteger(limit) && limit >= 5 && limit <= 300 ? limit : undefined;
}

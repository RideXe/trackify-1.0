/** Fields of a stored trip that reports use. */
export interface TripRecord {
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

export interface TripRow extends TripRecord {
  durationMs: number;
  /** Over the whole trip, including slow traffic. */
  averageSpeedKmh: number;
}

export interface Stop {
  address?: string;
  startTime: number;
  /** Unset while the vehicle is still parked. */
  endTime?: number;
  durationMs: number;
  latitude: number;
  longitude: number;
}

export interface GeofenceEvent {
  type: string;
  eventTime: number;
  geofenceId?: string;
}

export interface GeofenceVisit {
  geofenceId: string;
  /** Unset when the vehicle was already inside at the start of the period. */
  enterTime?: number;
  /** Unset while the vehicle is still inside. */
  exitTime?: number;
  durationMs?: number;
}

export interface DailyStatsRecord {
  sk: string;
  distanceM?: number;
  tripCount?: number;
  movingTimeS?: number;
  maxSpeedKmh?: number;
  engineHoursS?: number;
}

export interface Summary {
  days: number;
  distanceM: number;
  tripCount: number;
  movingTimeS: number;
  maxSpeedKmh: number;
}

export function tripRows(trips: readonly TripRecord[]): TripRow[] {
  return [...trips]
    .sort((a, b) => a.startTime - b.startTime)
    .map((trip) => {
      const durationMs = Math.max(0, trip.endTime - trip.startTime);
      return {
        ...pickTrip(trip),
        durationMs,
        averageSpeedKmh: durationMs ? round1(trip.distanceM / 1000 / (durationMs / 3_600_000)) : 0,
      };
    });
}

/** The legacy server's minimal parking duration: shorter halts are traffic, not stops. */
export const MINIMUM_STOP_MS = 300_000;

/**
 * Stops are the time between trips, parked where the previous trip ended. A stop after the last
 * trip is still running when the period reaches the present.
 */
export function stops(
  trips: readonly TripRecord[],
  period: { to: number; now: number },
  minimumMs = MINIMUM_STOP_MS,
): Stop[] {
  const ordered = [...trips].sort((a, b) => a.startTime - b.startTime);
  const result: Stop[] = [];
  ordered.forEach((trip, index) => {
    const next = ordered[index + 1];
    const ongoing = !next && period.to >= period.now;
    const endTime = next ? next.startTime : ongoing ? undefined : period.to;
    const durationMs = (endTime ?? period.now) - trip.endTime;
    if (durationMs < minimumMs) return;
    result.push({
      startTime: trip.endTime,
      endTime,
      durationMs,
      latitude: trip.endLatitude,
      longitude: trip.endLongitude,
      ...(trip.endAddress ? { address: trip.endAddress } : {}),
    });
  });
  return result;
}

/** Pairs geofence enter and exit events into visits, per geofence. */
export function geofenceVisits(events: readonly GeofenceEvent[], now: number): GeofenceVisit[] {
  const open = new Map<string, number>();
  const visits: GeofenceVisit[] = [];
  for (const event of [...events].sort((a, b) => a.eventTime - b.eventTime)) {
    if (!event.geofenceId) continue;
    if (event.type === 'geofenceEnter') {
      if (!open.has(event.geofenceId)) open.set(event.geofenceId, event.eventTime);
    } else if (event.type === 'geofenceExit') {
      const enterTime = open.get(event.geofenceId);
      open.delete(event.geofenceId);
      visits.push({
        geofenceId: event.geofenceId,
        enterTime,
        exitTime: event.eventTime,
        durationMs: enterTime === undefined ? undefined : event.eventTime - enterTime,
      });
    }
  }
  for (const [geofenceId, enterTime] of open)
    visits.push({ geofenceId, enterTime, durationMs: now - enterTime });
  return visits.sort((a, b) => (a.enterTime ?? a.exitTime ?? 0) - (b.enterTime ?? b.exitTime ?? 0));
}

export function summarise(days: readonly DailyStatsRecord[]): Summary {
  return days.reduce<Summary>(
    (total, day) => ({
      days: total.days + 1,
      distanceM: total.distanceM + (day.distanceM ?? 0),
      tripCount: total.tripCount + (day.tripCount ?? 0),
      movingTimeS: total.movingTimeS + (day.movingTimeS ?? 0),
      maxSpeedKmh: Math.max(total.maxSpeedKmh, day.maxSpeedKmh ?? 0),
    }),
    { days: 0, distanceM: 0, tripCount: 0, movingTimeS: 0, maxSpeedKmh: 0 },
  );
}

function pickTrip(trip: TripRecord): TripRecord {
  return {
    tripId: trip.tripId,
    startTime: trip.startTime,
    endTime: trip.endTime,
    distanceM: trip.distanceM,
    maxSpeedKmh: trip.maxSpeedKmh,
    startLatitude: trip.startLatitude,
    startLongitude: trip.startLongitude,
    endLatitude: trip.endLatitude,
    endLongitude: trip.endLongitude,
    startAddress: trip.startAddress,
    endAddress: trip.endAddress,
  };
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

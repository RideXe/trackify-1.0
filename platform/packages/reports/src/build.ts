import { localTime, toCsv, type CsvColumn } from './csv';
import {
  geofenceVisits,
  stops,
  summarise,
  tripRows,
  type DailyStatsRecord,
  type GeofenceEvent,
  type TripRecord,
} from './derive';

export const reportKinds = [
  'trips',
  'stops',
  'summary',
  'events',
  'geofenceVisits',
  'positions',
] as const;
export type ReportKind = (typeof reportKinds)[number];

export function isReportKind(value: unknown): value is ReportKind {
  return typeof value === 'string' && (reportKinds as readonly string[]).includes(value);
}

export interface EventRecord extends GeofenceEvent {
  eventId?: string;
  alarm?: string;
  attributes?: Record<string, unknown>;
}

export interface PositionRecord {
  fixTime: number;
  latitude: number;
  longitude: number;
  speedKmh?: number;
  courseDeg?: number;
  altitudeM?: number;
  address?: string;
  attributes?: Record<string, unknown>;
}

/** The stored history reports are built from, for one vehicle at a time. */
export interface ReportSource {
  trips(deviceId: string, from: number, to: number): Promise<TripRecord[]>;
  events(deviceId: string, from: number, to: number): Promise<EventRecord[]>;
  dailyStats(deviceId: string, fromDay: string, toDay: string): Promise<DailyStatsRecord[]>;
  positions(deviceId: string, from: number, to: number): Promise<PositionRecord[]>;
}

export interface ReportContext {
  timeZone: string;
  now: number;
  geofenceNames: ReadonlyMap<string, string>;
}

export interface BuiltReport {
  kind: ReportKind;
  rowCount: number;
  csv: string;
}

interface Vehicle {
  deviceId: string;
  name: string;
}

type Row = Record<string, string | number | boolean | undefined>;

/** One CSV for a report over any number of vehicles; each row names its vehicle. */
export async function buildReport(
  kind: ReportKind,
  vehicles: readonly Vehicle[],
  period: { from: number; to: number },
  source: ReportSource,
  context: ReportContext,
): Promise<BuiltReport> {
  const rows: Row[] = [];
  const time = (at: number | undefined) => localTime(at, context.timeZone);
  const minutes = (ms: number | undefined) =>
    ms === undefined ? undefined : Math.round(ms / 60_000);
  const km = (metres: number) => Math.round(metres / 100) / 10;
  for (const vehicle of vehicles) {
    const base = { vehicle: vehicle.name };
    if (kind === 'trips') {
      for (const trip of tripRows(await source.trips(vehicle.deviceId, period.from, period.to)))
        rows.push({
          ...base,
          start: time(trip.startTime),
          end: time(trip.endTime),
          durationMin: minutes(trip.durationMs),
          distanceKm: km(trip.distanceM),
          averageSpeedKmh: trip.averageSpeedKmh,
          maxSpeedKmh: trip.maxSpeedKmh,
          startLocation:
            trip.startAddress ??
            `${trip.startLatitude.toFixed(5)}, ${trip.startLongitude.toFixed(5)}`,
          endLocation:
            trip.endAddress ?? `${trip.endLatitude.toFixed(5)}, ${trip.endLongitude.toFixed(5)}`,
        });
    } else if (kind === 'stops') {
      const trips = await source.trips(vehicle.deviceId, period.from, period.to);
      for (const stop of stops(trips, { to: period.to, now: context.now }))
        rows.push({
          ...base,
          start: time(stop.startTime),
          end: time(stop.endTime),
          durationMin: minutes(stop.durationMs),
          location: stop.address ?? `${stop.latitude.toFixed(5)}, ${stop.longitude.toFixed(5)}`,
        });
    } else if (kind === 'summary') {
      // Daily stats are keyed by UTC day when trips are recorded.
      const days = await source.dailyStats(
        vehicle.deviceId,
        new Date(period.from).toISOString().slice(0, 10),
        new Date(period.to).toISOString().slice(0, 10),
      );
      const total = summarise(days);
      rows.push({
        ...base,
        days: total.days,
        distanceKm: km(total.distanceM),
        trips: total.tripCount,
        movingTimeMin: Math.round(total.movingTimeS / 60),
        maxSpeedKmh: total.maxSpeedKmh,
      });
    } else if (kind === 'events') {
      for (const event of await source.events(vehicle.deviceId, period.from, period.to))
        rows.push({
          ...base,
          time: time(event.eventTime),
          type: event.type,
          alarm: event.alarm,
          geofence: event.geofenceId
            ? (context.geofenceNames.get(event.geofenceId) ?? event.geofenceId)
            : undefined,
        });
    } else if (kind === 'geofenceVisits') {
      const events = await source.events(vehicle.deviceId, period.from, period.to);
      for (const visit of geofenceVisits(events, Math.min(context.now, period.to)))
        rows.push({
          ...base,
          geofence: context.geofenceNames.get(visit.geofenceId) ?? visit.geofenceId,
          entered: time(visit.enterTime),
          exited: time(visit.exitTime),
          durationMin: minutes(visit.durationMs),
        });
    } else {
      for (const position of await source.positions(vehicle.deviceId, period.from, period.to))
        rows.push({
          ...base,
          time: time(position.fixTime),
          latitude: position.latitude,
          longitude: position.longitude,
          speedKmh: position.speedKmh,
          courseDeg: position.courseDeg,
          altitudeM: position.altitudeM,
          address: position.address,
          ignition: position.attributes?.ignition as boolean | undefined,
        });
    }
  }
  return { kind, rowCount: rows.length, csv: toCsv(rows, columnsFor(rows)) };
}

const HEADERS: Record<string, string> = {
  vehicle: 'Vehicle',
  start: 'Start',
  end: 'End',
  durationMin: 'Duration (min)',
  distanceKm: 'Distance (km)',
  averageSpeedKmh: 'Average speed (km/h)',
  maxSpeedKmh: 'Max speed (km/h)',
  startLocation: 'Start location',
  endLocation: 'End location',
  location: 'Location',
  days: 'Days',
  trips: 'Trips',
  movingTimeMin: 'Moving time (min)',
  time: 'Time',
  type: 'Event',
  alarm: 'Alarm',
  geofence: 'Geofence',
  entered: 'Entered',
  exited: 'Exited',
  latitude: 'Latitude',
  longitude: 'Longitude',
  speedKmh: 'Speed (km/h)',
  courseDeg: 'Course (°)',
  altitudeM: 'Altitude (m)',
  address: 'Address',
  ignition: 'Ignition',
};

/** Columns in first-seen order, so an empty report still has a header row for its kind. */
function columnsFor(rows: Row[]): CsvColumn<Row>[] {
  const keys = rows.length ? Object.keys(rows[0]!) : ['vehicle'];
  return keys.map((key) => ({ header: HEADERS[key] ?? key, value: (row: Row) => row[key] }));
}

/** The calendar day (YYYY-MM-DD) an instant falls on in the fleet's zone. */
export function localDay(at: number, timeZone: string): string {
  return (localTime(at, timeZone) ?? '').slice(0, 10);
}

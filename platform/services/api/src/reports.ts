import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import type {
  FleetUser,
  Geofence,
  Group,
  Membership,
  ScheduledReport,
  ScheduledReportInput,
} from '@trackify/data';
import { eventTypeSchema } from '@trackify/domain';
import {
  buildReport,
  downsample,
  geofenceVisits,
  isReportKind,
  nextReportRun,
  reportSchedules,
  stops,
  type DailyStatsRecord,
  type EventRecord,
  type GeofenceEvent,
  type PositionRecord,
  type ReportKind,
  type ReportSource,
  type TripRecord,
} from '@trackify/reports';
import { sees } from './admin';
import { boundedNumber, InputError, isRecord, jsonObject, response, text } from './http';

const DAY = 86_400_000;
const MAX_RANGE = 31 * DAY;
const POSITION_LIMIT = 5_000;
const DEFAULT_TIME_ZONE = 'Asia/Kolkata';
const MAX_SCHEDULED = 50;

type Item = Record<string, unknown>;

export interface ReportData {
  getDevice(
    tenantId: string,
    deviceId: string,
  ): Promise<{ deviceId: string; name: string; groupId?: string } | undefined>;
  listDevices(
    tenantId: string,
  ): Promise<Array<{ deviceId: string; name?: string; groupId?: string }>>;
  positions(
    tenantId: string,
    deviceId: string,
    from: number,
    to: number,
    limit: number,
  ): Promise<unknown[] | undefined>;
  events(
    tenantId: string,
    deviceId: string,
    from: number,
    to: number,
    limit: number,
  ): Promise<unknown[] | undefined>;
  trips(
    tenantId: string,
    deviceId: string,
    from: number,
    to: number,
    limit: number,
  ): Promise<unknown[] | undefined>;
  dailyStats(
    tenantId: string,
    deviceId: string,
    fromDay: string,
    toDay: string,
  ): Promise<unknown[] | undefined>;
  tenantEvents(tenantId: string, from: number, to: number, limit: number): Promise<unknown[]>;
  listGeofences(tenantId: string): Promise<Geofence[]>;
  listGroups(tenantId: string): Promise<Group[]>;
  listUsers(tenantId: string): Promise<FleetUser[]>;
  timeZone(tenantId: string): Promise<string | undefined>;
}

export interface ReportStore {
  list(tenantId: string): Promise<ScheduledReport[]>;
  get(tenantId: string, reportId: string): Promise<ScheduledReport | undefined>;
  create(tenantId: string, input: ScheduledReportInput): Promise<ScheduledReport>;
  update(
    tenantId: string,
    reportId: string,
    changes: Partial<ScheduledReportInput>,
  ): Promise<ScheduledReport | undefined>;
  remove(tenantId: string, reportId: string): Promise<boolean>;
}

/** Report endpoints beyond the raw history routes in the main handler. */
export function createReportRoutes(
  data: ReportData,
  scheduled?: ReportStore,
  now: () => number = Date.now,
) {
  return async (
    event: APIGatewayProxyEventV2WithJWTAuthorizer,
    membership: Membership,
  ): Promise<ReturnType<typeof response> | ReturnType<typeof csv> | undefined> => {
    const method = event.requestContext.http.method;
    const path = event.rawPath;
    const query = event.queryStringParameters ?? {};
    const { tenantId } = membership;
    const wantsCsv = query.format === 'csv';
    if (method === 'GET') {
      const deviceReport = path.match(
        /^\/devices\/([^/]+)\/(positions|events|trips|summary|stops|geofence-visits|chart)$/,
      );
      if (deviceReport?.[1] && deviceReport[2]) {
        const [, deviceId, name] = deviceReport;
        // positions, events, trips and summary as JSON stay with the main handler.
        if (!wantsCsv && ['positions', 'events', 'trips', 'summary'].includes(name))
          return undefined;
        const device = await data.getDevice(tenantId, deviceId);
        if (!device) return response(404, { message: 'device not found' });
        const period = range(query, now());
        if (name === 'chart')
          return response(200, await chart(data, tenantId, deviceId, period, query));
        if (!wantsCsv) {
          const trips = name === 'stops' ? await tripsOf(data, tenantId, deviceId, period) : [];
          if (name === 'stops')
            return response(200, { items: stops(trips, { to: period.to, now: now() }) });
          const events = (await data.events(
            tenantId,
            deviceId,
            period.from,
            period.to,
            POSITION_LIMIT,
          )) as Item[];
          return response(200, {
            items: geofenceVisits(events as unknown as GeofenceEvent[], Math.min(now(), period.to)),
          });
        }
        const kind = KIND_BY_PATH[name]!;
        const report = await build(data, tenantId, kind, [device], period, now());
        return csv(report.csv, `${kind}-${slug(device.name)}-${day(period.from)}.csv`);
      }
      if (path === '/events') {
        const period = range(query, now());
        const types = query.types?.split(',').filter(Boolean) ?? [];
        if (types.some((type) => !eventTypeSchema.safeParse(type).success))
          throw new InputError('types lists an unknown event type');
        const devices = await data.listDevices(tenantId);
        const visible = new Map(
          devices
            .filter((device) => sees(membership, device.groupId))
            .map((device) => [device.deviceId, device.name]),
        );
        const limit = boundedNumber(query.limit, 1_000, 1, POSITION_LIMIT);
        const items = (
          (await data.tenantEvents(tenantId, period.from, period.to, POSITION_LIMIT)) as Item[]
        )
          .filter(
            (item) =>
              visible.has(String(item.deviceId)) &&
              (!types.length || types.includes(String(item.type))),
          )
          .slice(0, limit)
          .map((item) => ({
            ...publicEvent(item),
            deviceName: visible.get(String(item.deviceId)),
          }));
        return response(200, { items });
      }
      const fleetReport = path.match(/^\/reports\/([A-Za-z]+)$/);
      if (fleetReport?.[1]) {
        if (!isReportKind(fleetReport[1])) return response(404, { message: 'unknown report' });
        const period = range(query, now());
        const vehicles = await selectVehicles(data, membership, {
          deviceIds: list(query.deviceIds),
          groupIds: list(query.groupIds),
        });
        if (fleetReport[1] === 'positions' && vehicles.length > 10)
          throw new InputError('position exports are limited to 10 vehicles');
        const report = await build(data, tenantId, fleetReport[1], vehicles, period, now());
        return csv(report.csv, `${fleetReport[1]}-${day(period.from)}.csv`);
      }
    }

    if (path === '/scheduled-reports' || path.startsWith('/scheduled-reports/')) {
      if (!scheduled) return response(503, { message: 'scheduled reports unavailable' });
      if (membership.role !== 'admin') return response(403, { message: 'admin role required' });
      const timeZone = (await data.timeZone(tenantId)) ?? DEFAULT_TIME_ZONE;
      if (path === '/scheduled-reports' && method === 'GET')
        return response(200, { items: await scheduled.list(tenantId) });
      if (path === '/scheduled-reports' && method === 'POST') {
        const input = parseScheduled(event.body) as Omit<ScheduledReportInput, 'nextRunAt'>;
        if ((await scheduled.list(tenantId)).length >= MAX_SCHEDULED)
          return response(409, {
            message: `an account can have at most ${MAX_SCHEDULED} scheduled reports`,
          });
        await checkReferences(data, tenantId, input);
        return response(
          201,
          await scheduled.create(tenantId, {
            ...input,
            nextRunAt: nextReportRun(input.schedule, now(), timeZone),
          }),
        );
      }
      const match = path.match(/^\/scheduled-reports\/([^/]+)$/);
      if (match?.[1] && method === 'PATCH') {
        const existing = await scheduled.get(tenantId, match[1]);
        if (!existing) return response(404, { message: 'scheduled report not found' });
        const changes = parseScheduled(event.body, true) as Partial<ScheduledReportInput>;
        await checkReferences(data, tenantId, { ...existing, ...changes });
        if (changes.schedule || changes.enabled)
          changes.nextRunAt = nextReportRun(changes.schedule ?? existing.schedule, now(), timeZone);
        const report = await scheduled.update(tenantId, match[1], changes);
        return report
          ? response(200, report)
          : response(404, { message: 'scheduled report not found' });
      }
      if (match?.[1] && method === 'DELETE')
        return (await scheduled.remove(tenantId, match[1]))
          ? response(204, undefined)
          : response(404, { message: 'scheduled report not found' });
    }
    return undefined;
  };
}

const KIND_BY_PATH: Record<string, ReportKind> = {
  positions: 'positions',
  events: 'events',
  trips: 'trips',
  summary: 'summary',
  stops: 'stops',
  'geofence-visits': 'geofenceVisits',
};

/** Numeric series for charts: top-level position fields, decoded attributes, or raw IO values. */
async function chart(
  data: ReportData,
  tenantId: string,
  deviceId: string,
  period: { from: number; to: number },
  query: Record<string, string | undefined>,
) {
  const attribute = query.attribute ?? 'speedKmh';
  if (!/^[A-Za-z][A-Za-z0-9.]{0,40}$/.test(attribute)) throw new InputError('attribute is invalid');
  const points = boundedNumber(query.points, 500, 10, 2_000);
  const positions = ((await data.positions(
    tenantId,
    deviceId,
    period.from,
    period.to,
    POSITION_LIMIT,
  )) ?? []) as Item[];
  const series = positions
    .map((position) => ({
      time: Number(position.fixTime),
      value: numericValue(position, attribute),
    }))
    .filter((point): point is { time: number; value: number } => point.value !== undefined)
    .sort((a, b) => a.time - b.time);
  return {
    attribute,
    truncated: positions.length >= POSITION_LIMIT,
    items: downsample(series, points),
  };
}

function numericValue(position: Item, attribute: string): number | undefined {
  const attributes = isRecord(position.attributes) ? position.attributes : {};
  const io = isRecord(attributes.io) ? attributes.io : {};
  const raw =
    position[attribute] ??
    attributes[attribute] ??
    io[attribute] ??
    io[attribute.replace(/^io\./, '')];
  const value = typeof raw === 'boolean' ? Number(raw) : Number(raw);
  return raw === undefined || raw === null || raw === '' || !Number.isFinite(value)
    ? undefined
    : value;
}

async function build(
  data: ReportData,
  tenantId: string,
  kind: ReportKind,
  vehicles: Array<{ deviceId: string; name: string }>,
  period: { from: number; to: number },
  now: number,
) {
  const [timeZone, geofences] = await Promise.all([
    data.timeZone(tenantId),
    data.listGeofences(tenantId),
  ]);
  return buildReport(kind, vehicles, period, reportSource(data, tenantId), {
    timeZone: timeZone ?? DEFAULT_TIME_ZONE,
    now,
    geofenceNames: new Map(geofences.map((geofence) => [geofence.geofenceId, geofence.name])),
  });
}

/** Adapts the fleet store's per-vehicle queries to the report builder, oldest first. */
export function reportSource(
  data: Pick<ReportData, 'positions' | 'events' | 'trips' | 'dailyStats'>,
  tenantId: string,
): ReportSource {
  const ascending = (items: unknown[] | undefined, key: string) =>
    ((items ?? []) as Item[]).sort((a, b) => Number(a[key]) - Number(b[key]));
  // Stored rows carry the report fields plus keys; the builder reads only the fields it names.
  return {
    trips: async (deviceId, from, to) =>
      ascending(
        await data.trips(tenantId, deviceId, from, to, POSITION_LIMIT),
        'startTime',
      ) as unknown as TripRecord[],
    events: async (deviceId, from, to) =>
      ascending(
        await data.events(tenantId, deviceId, from, to, POSITION_LIMIT),
        'eventTime',
      ) as unknown as EventRecord[],
    dailyStats: async (deviceId, fromDay, toDay) =>
      ((await data.dailyStats(tenantId, deviceId, fromDay, toDay)) ??
        []) as unknown as DailyStatsRecord[],
    positions: async (deviceId, from, to) =>
      ascending(
        await data.positions(tenantId, deviceId, from, to, POSITION_LIMIT),
        'fixTime',
      ) as unknown as PositionRecord[],
  };
}

/** The vehicles a report covers: those chosen (or all), and only those the user may see. */
export async function selectVehicles(
  data: Pick<ReportData, 'listDevices'>,
  membership: Pick<Membership, 'tenantId' | 'role' | 'groupIds'>,
  selection: { deviceIds: string[]; groupIds: string[] },
) {
  const all = await data.listDevices(membership.tenantId);
  const everything = !selection.deviceIds.length && !selection.groupIds.length;
  return all
    .filter(
      (device) =>
        sees(membership as Membership, device.groupId) &&
        (everything ||
          selection.deviceIds.includes(device.deviceId) ||
          (device.groupId !== undefined && selection.groupIds.includes(device.groupId))),
    )
    .map((device) => ({ deviceId: device.deviceId, name: device.name ?? device.deviceId }));
}

async function tripsOf(
  data: ReportData,
  tenantId: string,
  deviceId: string,
  period: { from: number; to: number },
) {
  return ((await data.trips(tenantId, deviceId, period.from, period.to, POSITION_LIMIT)) ??
    []) as unknown as TripRecord[];
}

function range(query: Record<string, string | undefined>, now: number) {
  const from = boundedNumber(query.from, now - DAY, 0, now);
  const to = boundedNumber(query.to, now, from, Math.min(now + 300_000, from + MAX_RANGE));
  return { from, to };
}

function list(value: string | undefined) {
  return value?.split(',').filter(Boolean) ?? [];
}

const STORAGE_KEYS = new Set(['pk', 'sk', 'tenantMonthPk', 'tenantMonthSk', 'expiresAt']);

function publicEvent(item: Item) {
  return Object.fromEntries(Object.entries(item).filter(([key]) => !STORAGE_KEYS.has(key)));
}

function parseScheduled(body: string | undefined, partial = false) {
  const value = jsonObject(body);
  const result: Record<string, unknown> = {};
  const set = (key: string, parse: (input: unknown) => unknown) => {
    if (value[key] !== undefined || !partial) result[key] = parse(value[key]);
  };
  set('name', (name) => {
    const trimmed = text(name, 'name', 1, 100).trim();
    if (!trimmed) throw new InputError('name is invalid');
    return trimmed;
  });
  set('kind', (kind) => {
    if (!isReportKind(kind) || kind === 'positions')
      throw new InputError('kind must be trips, stops, summary, events or geofenceVisits');
    return kind;
  });
  set('schedule', (schedule) => {
    if (!(reportSchedules as readonly unknown[]).includes(schedule))
      throw new InputError('schedule must be daily, weekly or monthly');
    return schedule;
  });
  set('enabled', (enabled) => {
    if (enabled === undefined) return true;
    if (typeof enabled !== 'boolean') throw new InputError('enabled must be true or false');
    return enabled;
  });
  for (const key of ['deviceIds', 'groupIds', 'userIds'])
    set(key, (ids) => {
      if (ids === undefined) return [];
      if (
        !Array.isArray(ids) ||
        ids.length > 500 ||
        ids.some((id) => typeof id !== 'string' || !id || id.length > 64)
      )
        throw new InputError(`${key} must be a list of ids`);
      return [...new Set(ids as string[])];
    });
  if (partial && !Object.keys(result).length)
    throw new InputError('at least one field to change is required');
  return result;
}

async function checkReferences(
  data: ReportData,
  tenantId: string,
  report: Pick<ScheduledReportInput, 'deviceIds' | 'groupIds' | 'userIds'>,
) {
  const [devices, groups, users] = await Promise.all([
    report.deviceIds.length ? data.listDevices(tenantId) : [],
    report.groupIds.length ? data.listGroups(tenantId) : [],
    report.userIds.length ? data.listUsers(tenantId) : [],
  ]);
  const unknown = [
    ...report.deviceIds
      .filter((id) => !devices.some((device) => device.deviceId === id))
      .map((id) => `vehicle ${id}`),
    ...report.groupIds
      .filter((id) => !groups.some((group) => group.groupId === id))
      .map((id) => `group ${id}`),
    ...report.userIds
      .filter((id) => !users.some((user) => user.userId === id))
      .map((id) => `user ${id}`),
  ];
  if (unknown.length) throw new InputError(`unknown ${unknown.join(', ')}`);
}

export function csv(body: string, filename: string) {
  return {
    statusCode: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
    body,
  };
}

function slug(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'vehicle'
  );
}

function day(at: number) {
  return new Date(at).toISOString().slice(0, 10);
}

import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import type { ScheduledReport } from '@trackify/data';
import { describe, expect, it, vi } from 'vitest';
import { InputError } from '../src/http';
import {
  createReportRoutes,
  selectVehicles,
  type ReportData,
  type ReportStore,
} from '../src/reports';

const NOW = Date.parse('2026-10-12T12:00:00+05:30');
const MIN = 60_000;

function request(
  method: string,
  rawPath: string,
  query: Record<string, string> = {},
  body?: unknown,
) {
  return {
    rawPath,
    queryStringParameters: query,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { http: { method } },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

const admin = { tenantId: 't', userId: 'u', role: 'admin' as const, groupIds: [] };
const northOnly = { ...admin, role: 'dispatcher' as const, groupIds: ['north'] };

const trip = (startMin: number, endMin: number) => ({
  tripId: `t${startMin}`,
  startTime: NOW - 600 * MIN + startMin * MIN,
  endTime: NOW - 600 * MIN + endMin * MIN,
  distanceM: 12_000,
  maxSpeedKmh: 70,
  startLatitude: 12.97,
  startLongitude: 77.59,
  endLatitude: 12.99,
  endLongitude: 77.61,
});

function data(overrides: Partial<ReportData> = {}) {
  return {
    getDevice: vi.fn((_t: string, deviceId: string) =>
      Promise.resolve(
        deviceId === 'van' ? { deviceId: 'van', name: 'Van =1', groupId: 'north' } : undefined,
      ),
    ),
    listDevices: vi.fn().mockResolvedValue([
      { deviceId: 'van', name: 'Van', groupId: 'north' },
      { deviceId: 'bus', name: 'Bus', groupId: 'south' },
    ]),
    positions: vi.fn().mockResolvedValue([
      {
        fixTime: NOW - 2 * MIN,
        latitude: 1,
        longitude: 2,
        speedKmh: 30,
        attributes: { io: { '66': 12_500 } },
      },
      {
        fixTime: NOW - 3 * MIN,
        latitude: 1,
        longitude: 2,
        speedKmh: 90,
        attributes: { fuelLevelPct: 40 },
      },
    ]),
    events: vi.fn().mockResolvedValue([
      { type: 'geofenceEnter', eventTime: NOW - 50 * MIN, geofenceId: 'depot' },
      { type: 'geofenceExit', eventTime: NOW - 20 * MIN, geofenceId: 'depot' },
    ]),
    trips: vi.fn().mockResolvedValue([trip(60, 90), trip(0, 30)]),
    dailyStats: vi
      .fn()
      .mockResolvedValue([{ sk: '2026-10-12', distanceM: 24_000, tripCount: 2, maxSpeedKmh: 70 }]),
    tenantEvents: vi.fn().mockResolvedValue([
      { pk: 'x', deviceId: 'van', type: 'alarm', eventTime: NOW - MIN, tenantMonthPk: 'x' },
      { pk: 'y', deviceId: 'bus', type: 'alarm', eventTime: NOW - 2 * MIN },
      { pk: 'z', deviceId: 'van', type: 'ignitionOn', eventTime: NOW - 3 * MIN },
    ]),
    listGeofences: vi.fn().mockResolvedValue([
      {
        tenantId: 't',
        geofenceId: 'depot',
        name: 'Main depot',
        shape: { type: 'circle', center: { latitude: 1, longitude: 2 }, radiusM: 50 },
      },
    ]),
    listGroups: vi.fn().mockResolvedValue([{ tenantId: 't', groupId: 'north', name: 'North' }]),
    listUsers: vi
      .fn()
      .mockResolvedValue([
        { tenantId: 't', userId: 'asha', role: 'admin', enabled: true, groupIds: [] },
      ]),
    timeZone: vi.fn().mockResolvedValue('Asia/Kolkata'),
    ...overrides,
  } satisfies ReportData;
}

async function call(
  routes: ReturnType<typeof createReportRoutes>,
  ...args: Parameters<typeof routes>
) {
  try {
    return await routes(...args);
  } catch (error) {
    if (error instanceof InputError) return { statusCode: 400, headers: {}, body: error.message };
    throw error;
  }
}

const json = (result: { body: string } | undefined) =>
  JSON.parse(result!.body) as { items: Array<Record<string, unknown>> };

describe('vehicle reports', () => {
  it('lists stops between trips', async () => {
    const result = await call(
      createReportRoutes(data(), undefined, () => NOW),
      request('GET', '/devices/van/stops'),
      admin,
    );
    const items = json(result).items;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ durationMs: 30 * MIN, latitude: 12.99 });
    // The vehicle is still parked after its last trip, so that stop has no end yet.
    expect(items[1]).not.toHaveProperty('endTime');
  });

  it('pairs geofence visits', async () => {
    const result = await call(
      createReportRoutes(data(), undefined, () => NOW),
      request('GET', '/devices/van/geofence-visits'),
      admin,
    );
    expect(json(result).items).toEqual([
      {
        geofenceId: 'depot',
        enterTime: NOW - 50 * MIN,
        exitTime: NOW - 20 * MIN,
        durationMs: 30 * MIN,
      },
    ]);
  });

  it('charts a top-level field, a decoded attribute or a raw IO value, oldest first', async () => {
    const routes = createReportRoutes(data(), undefined, () => NOW);
    const speed = json(await call(routes, request('GET', '/devices/van/chart'), admin));
    expect(speed.items.map((point) => point.value)).toEqual([90, 30]);
    const fuel = json(
      await call(
        routes,
        request('GET', '/devices/van/chart', { attribute: 'fuelLevelPct' }),
        admin,
      ),
    );
    expect(fuel.items).toEqual([{ time: NOW - 3 * MIN, value: 40 }]);
    const io = json(
      await call(routes, request('GET', '/devices/van/chart', { attribute: 'io.66' }), admin),
    );
    expect(io.items).toEqual([{ time: NOW - 2 * MIN, value: 12_500 }]);
  });

  it('exports CSV with a safe file name and defused vehicle names', async () => {
    const result = await call(
      createReportRoutes(data(), undefined, () => NOW),
      request('GET', '/devices/van/trips', { format: 'csv' }),
      admin,
    );
    const headers = new Map(Object.entries(result?.headers ?? {}));
    expect(headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(headers.get('content-disposition')).toMatch(
      /^attachment; filename="trips-van-1-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    const lines = result!.body.split('\r\n');
    expect(lines[0]).toContain('Vehicle,Start,End,Duration (min),Distance (km)');
    expect(lines[1]).toMatch(/^'=1|^'Van =1|^Van =1/);
    expect(lines).toHaveLength(4);
  });

  it('leaves JSON history to the main handler', async () => {
    const result = await call(
      createReportRoutes(data(), undefined, () => NOW),
      request('GET', '/devices/van/trips'),
      admin,
    );
    expect(result).toBeUndefined();
  });

  it('caps the period at a month', async () => {
    const result = await call(
      createReportRoutes(data(), undefined, () => NOW),
      request('GET', '/devices/van/stops', {
        from: String(NOW - 40 * 86_400_000),
        to: String(NOW),
      }),
      admin,
    );
    expect(result?.statusCode).toBe(400);
  });
});

describe('fleet reports', () => {
  it('lists fleet-wide events for visible vehicles, filtered by type, without storage keys', async () => {
    const result = await call(
      createReportRoutes(data(), undefined, () => NOW),
      request('GET', '/events', { types: 'alarm' }),
      northOnly,
    );
    expect(json(result).items).toEqual([
      { deviceId: 'van', type: 'alarm', eventTime: NOW - MIN, deviceName: 'Van' },
    ]);
    const bad = await call(
      createReportRoutes(data(), undefined, () => NOW),
      request('GET', '/events', { types: 'party' }),
      admin,
    );
    expect(bad?.statusCode).toBe(400);
  });

  it('builds one CSV across chosen vehicles', async () => {
    const result = await call(
      createReportRoutes(data(), undefined, () => NOW),
      request('GET', '/reports/summary'),
      admin,
    );
    const lines = result!.body.split('\r\n');
    expect(lines[0]).toBe('﻿Vehicle,Days,Distance (km),Trips,Moving time (min),Max speed (km/h)');
    expect(lines.slice(1, 3)).toEqual(['Van,1,24,2,0,70', 'Bus,1,24,2,0,70']);
  });

  it('never includes vehicles outside the user’s groups', async () => {
    expect(
      await selectVehicles(data(), northOnly, { deviceIds: ['bus', 'van'], groupIds: [] }),
    ).toEqual([{ deviceId: 'van', name: 'Van' }]);
    expect(await selectVehicles(data(), admin, { deviceIds: [], groupIds: ['south'] })).toEqual([
      { deviceId: 'bus', name: 'Bus' },
    ]);
  });

  it('rejects unknown report kinds', async () => {
    const result = await call(
      createReportRoutes(data(), undefined, () => NOW),
      request('GET', '/reports/fun'),
      admin,
    );
    expect(result?.statusCode).toBe(404);
  });
});

describe('scheduled reports', () => {
  function store(existing: ScheduledReport[] = []) {
    return {
      list: vi.fn().mockResolvedValue(existing),
      get: vi.fn((_t: string, id: string) =>
        Promise.resolve(existing.find((report) => report.reportId === id)),
      ),
      create: vi.fn((tenantId: string, input: object) =>
        Promise.resolve({ ...input, tenantId, reportId: 'r1' } as ScheduledReport),
      ),
      update: vi.fn((_t: string, id: string, changes: object) =>
        Promise.resolve({ ...existing.find((report) => report.reportId === id)!, ...changes }),
      ),
      remove: vi.fn().mockResolvedValue(true),
    } satisfies ReportStore;
  }

  it('schedules the first run for 06:00 in the fleet’s time zone', async () => {
    const reports = store();
    const result = await call(
      createReportRoutes(data(), reports, () => NOW),
      request(
        'POST',
        '/scheduled-reports',
        {},
        { name: 'Daily trips', kind: 'trips', schedule: 'daily' },
      ),
      admin,
    );
    expect(result?.statusCode).toBe(201);
    expect(reports.create).toHaveBeenCalledWith('t', {
      name: 'Daily trips',
      kind: 'trips',
      schedule: 'daily',
      enabled: true,
      deviceIds: [],
      groupIds: [],
      userIds: [],
      nextRunAt: Date.parse('2026-10-13T06:00:00+05:30'),
    });
  });

  it('validates kind, schedule and references, and is for administrators', async () => {
    const routes = createReportRoutes(data(), store(), () => NOW);
    for (const body of [
      { name: 'X', kind: 'positions', schedule: 'daily' },
      { name: 'X', kind: 'trips', schedule: 'hourly' },
      { name: 'X', kind: 'trips', schedule: 'daily', userIds: ['ghost'] },
    ])
      expect(
        (await call(routes, request('POST', '/scheduled-reports', {}, body), admin))?.statusCode,
      ).toBe(400);
    expect((await call(routes, request('GET', '/scheduled-reports'), northOnly))?.statusCode).toBe(
      403,
    );
  });

  it('moves the next run when the schedule changes', async () => {
    const existing: ScheduledReport = {
      tenantId: 't',
      reportId: 'r1',
      name: 'Trips',
      kind: 'trips',
      schedule: 'daily',
      enabled: true,
      deviceIds: [],
      groupIds: [],
      userIds: [],
      nextRunAt: 0,
    };
    const reports = store([existing]);
    await call(
      createReportRoutes(data(), reports, () => NOW),
      request('PATCH', '/scheduled-reports/r1', {}, { schedule: 'monthly' }),
      admin,
    );
    expect(reports.update).toHaveBeenCalledWith('t', 'r1', {
      schedule: 'monthly',
      nextRunAt: Date.parse('2026-11-01T06:00:00+05:30'),
    });
  });
});

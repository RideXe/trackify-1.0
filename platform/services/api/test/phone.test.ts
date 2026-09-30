import { createHash } from 'node:crypto';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { ActivityEntry } from '@trackify/domain';
import { describe, expect, it, vi } from 'vitest';

for (const key of [
  'CORE_TABLE',
  'ONBOARDING_TABLE',
  'DEVICE_STATE_TABLE',
  'POSITIONS_TABLE',
  'EVENTS_TABLE',
  'TRIPS_TABLE',
  'DAILY_STATS_TABLE',
  'COMMANDS_TABLE',
  'PHOTOS_BUCKET',
  'DASHBOARD_URL',
])
  process.env[key] = key.toLowerCase();
const { createPhoneHandler, parseActivity } = await import('../src/phone');

const now = 1_800_000_000_000;
const prefix = 'tenants/tenant-a/devices/device-1/';

function request(method: string, rawPath: string, body?: unknown, token = 'phone-secret') {
  return {
    rawPath,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
    queryStringParameters: undefined,
    requestContext: { http: { method } },
  } as unknown as APIGatewayProxyEventV2;
}

function dependencies() {
  const hash = createHash('sha256').update('phone-secret').digest('hex');
  return {
    credentials: {
      resolveCredential: vi.fn((credentialHash: string) =>
        Promise.resolve(
          credentialHash === hash ? { tenantId: 'tenant-a', deviceId: 'device-1' } : undefined,
        ),
      ),
    },
    fleet: {
      getDevice: vi.fn().mockResolvedValue({
        deviceId: 'device-1',
        name: 'KA 01 AB 1234',
        vehicleType: 'car',
        driverId: 'driver-1',
        pauseLimitMinutes: 45,
      }),
      getDriver: vi.fn().mockResolvedValue({ name: 'Ramesh Kumar' }),
      trips: vi.fn().mockResolvedValue([
        { distanceM: 1500, startTime: now - 3_600_000, endTime: now - 3_000_000 },
        { distanceM: 500, startTime: now - 1_000_000, endTime: now - 700_000 },
      ]),
    },
    activity: {
      organisation: vi.fn().mockResolvedValue({
        tenantId: 'tenant-a',
        name: 'Acme Travels',
        dispatcherPhone: '+91 80 1234',
      }),
      append: vi.fn((_tenant: string, entry: object) =>
        Promise.resolve({ ...entry, entryId: 'entry-1', receivedAt: now } as ActivityEntry),
      ),
      list: vi.fn().mockResolvedValue([]),
      setDuty: vi.fn().mockResolvedValue(true),
      createAlert: vi.fn().mockResolvedValue({ alertId: 'alert-1' }),
    },
    photos: {
      uploadUrl: vi.fn((key: string) => Promise.resolve(`https://upload/${key}`)),
      viewUrl: vi.fn(),
    },
    notifier: { send: vi.fn().mockResolvedValue(undefined) },
    dashboardUrl: 'https://dash.example',
    now: () => now,
  };
}

describe('phone authentication', () => {
  it('rejects missing and revoked credentials, which is how the admin disconnects a phone', async () => {
    const handler = createPhoneHandler(dependencies());
    expect((await handler(request('GET', '/phone/config', undefined, ''))).statusCode).toBe(401);
    expect((await handler(request('GET', '/phone/config', undefined, 'revoked'))).statusCode).toBe(
      401,
    );
  });
});

describe('phone config', () => {
  it('tells the driver which organisation and vehicle they are connected to, with admin settings', async () => {
    const result = await createPhoneHandler(dependencies())(request('GET', '/phone/config'));
    expect(JSON.parse(result.body)).toEqual(
      expect.objectContaining({
        organisation: 'Acme Travels',
        dispatcherPhone: '+91 80 1234',
        vehicleName: 'KA 01 AB 1234',
        driverName: 'Ramesh Kumar',
        trackerIntervalSeconds: 30,
        pauseLimitMinutes: 45,
        dutyStatus: 'off',
      }),
    );
  });
});

describe('driver activity', () => {
  it('starts a shift and records the duty change on the vehicle', async () => {
    const deps = dependencies();
    const result = await createPhoneHandler(deps)(
      request('POST', '/phone/activity', { type: 'shift-start', at: now - 1000 }),
    );
    expect(result.statusCode).toBe(201);
    expect(deps.activity.setDuty).toHaveBeenCalledWith('tenant-a', 'device-1', {
      dutyStatus: 'on',
      dutySince: now - 1000,
      pauseReason: null,
      pauseUntil: null,
    });
    expect(deps.activity.createAlert).not.toHaveBeenCalled();
  });

  it("ends a pause at the administrator's limit, not one the phone sends", async () => {
    const deps = dependencies();
    await createPhoneHandler(deps)(
      request('POST', '/phone/activity', {
        type: 'pause',
        reason: 'break',
        at: now,
        until: now + 1,
      }),
    );
    expect(deps.activity.setDuty).toHaveBeenCalledWith(
      'tenant-a',
      'device-1',
      expect.objectContaining({
        dutyStatus: 'paused',
        pauseReason: 'break',
        pauseUntil: now + 45 * 60_000,
      }),
    );
  });

  it('raises a critical alert and emails the admin for SOS, with a map link', async () => {
    const deps = dependencies();
    await createPhoneHandler(deps)(
      request('POST', '/phone/activity', {
        type: 'sos',
        latitude: 12.97,
        longitude: 77.59,
        batteryPct: 40,
      }),
    );
    expect(deps.activity.createAlert).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'critical', deviceName: 'KA 01 AB 1234', type: 'sos' }),
    );
    const [subject, message] = deps.notifier.send.mock.calls[0] as [string, string];
    expect(subject).toContain('SOS');
    expect(message).toContain('https://maps.google.com/?q=12.97,77.59');
    expect(message).toContain('Ramesh Kumar');
    expect(message).toContain('https://dash.example/?vehicle=device-1');
  });

  it('still records the SOS when the email fails', async () => {
    const deps = dependencies();
    deps.notifier.send.mockRejectedValue(new Error('sns down'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await createPhoneHandler(deps)(
      request('POST', '/phone/activity', { type: 'sos' }),
    );
    expect(result.statusCode).toBe(201);
  });

  it('alerts on minor issues without emailing', async () => {
    const deps = dependencies();
    await createPhoneHandler(deps)(
      request('POST', '/phone/activity', { type: 'issue', kind: 'traffic' }),
    );
    expect(deps.activity.createAlert).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'warning' }),
    );
    expect(deps.notifier.send).not.toHaveBeenCalled();
  });
});

describe('parsing driver entries', () => {
  const parse = (body: unknown) => parseActivity(JSON.stringify(body), 'device-1', prefix, now);

  it('keeps only the fields that belong to the entry type', () => {
    expect(
      parse({ type: 'fuel', litres: 30.5, amount: 3200, odometerKm: 12000, reason: 'break' }),
    ).toEqual(expect.objectContaining({ litres: 30.5, amount: 3200, odometerKm: 12000 }));
    expect(parse({ type: 'fuel', litres: 30.5 })).not.toHaveProperty('reason');
  });

  it('rejects entries that do not make sense', () => {
    for (const body of [
      { type: 'shopping' },
      { type: 'pause' },
      { type: 'issue', kind: 'aliens' },
      { type: 'fuel' },
      { type: 'check', items: {} },
      { type: 'check', items: { wipers: 'ok' } },
      { type: 'sos', latitude: 12 },
      { type: 'sos', at: now - 30 * 86_400_000 },
      { type: 'issue', kind: 'accident', photoKey: 'tenants/other/devices/device-1/p.jpg' },
      { type: 'sos', photoKey: `${prefix}p.jpg` },
    ])
      expect(() => parse(body), JSON.stringify(body)).toThrow();
  });

  it('accepts a vehicle check and an issue photo from this vehicle', () => {
    expect(parse({ type: 'check', items: { tyres: 'ok', brakes: 'issue' } }).items).toEqual({
      tyres: 'ok',
      brakes: 'issue',
    });
    expect(parse({ type: 'issue', kind: 'accident', photoKey: `${prefix}01J.jpg` }).photoKey).toBe(
      `${prefix}01J.jpg`,
    );
  });
});

describe('photos, messages and today', () => {
  it("hands out an upload URL inside this vehicle's folder", async () => {
    const result = await createPhoneHandler(dependencies())(request('POST', '/phone/photos'));
    const body = JSON.parse(result.body) as { photoKey: string; uploadUrl: string };
    expect(body.photoKey.startsWith(prefix)).toBe(true);
    expect(body.uploadUrl).toBe(`https://upload/${body.photoKey}`);
  });

  it('only reads messages for this vehicle', async () => {
    const deps = dependencies();
    await createPhoneHandler(deps)(request('GET', '/phone/messages'));
    expect(deps.activity.list).toHaveBeenCalledWith(
      'tenant-a',
      'device-1',
      expect.any(Number),
      now,
      50,
      'message',
    );
  });

  it("sums today's completed trips", async () => {
    const result = await createPhoneHandler(dependencies())(request('GET', '/phone/today'));
    expect(JSON.parse(result.body)).toEqual({ trips: 2, distanceM: 2000, drivingMs: 900_000 });
  });
});

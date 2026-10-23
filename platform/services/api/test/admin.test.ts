import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import type { FleetUser, Geofence, Group } from '@trackify/data';
import { describe, expect, it, vi } from 'vitest';

process.env.CORE_TABLE = 'core';
process.env.DEVICE_STATE_TABLE = 'state';
process.env.POSITIONS_TABLE = 'positions';
process.env.EVENTS_TABLE = 'events';
process.env.TRIPS_TABLE = 'trips';
process.env.DAILY_STATS_TABLE = 'daily';
process.env.COMMANDS_TABLE = 'commands';
process.env.ONBOARDING_TABLE = 'onboarding';
process.env.ONBOARDING_WEB_URL = 'https://trackify.example';
process.env.PHOTOS_BUCKET = 'photos';
process.env.USER_POOL_ID = 'pool';
const { createHandler } = await import('../src/handler');
const { MAX_GEOFENCES } = await import('../src/admin');

type Role = 'admin' | 'dispatcher' | 'viewer';

function request(method: string, rawPath: string, body?: unknown) {
  return {
    rawPath,
    headers: {},
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: {
      http: { method },
      authorizer: { jwt: { claims: { sub: 'user-1' }, scopes: [] } },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

const vehicles = [
  { deviceId: 'north-van', name: 'North Van', groupId: 'north' },
  { deviceId: 'south-bus', name: 'South Bus', groupId: 'south' },
  { deviceId: 'spare-car', name: 'Spare Car', groupId: 'UNGROUPED' },
];

function fleet(role: Role = 'admin', groupIds: string[] = []) {
  return {
    membership: vi
      .fn()
      .mockResolvedValue({ tenantId: 'tenant-a', userId: 'user-1', role, groupIds }),
    listDevices: vi.fn().mockResolvedValue(vehicles),
    getDevice: vi.fn((_tenant: string, deviceId: string) =>
      Promise.resolve(
        vehicles
          .map((vehicle) => ({ ...vehicle, uniqueId: 'imei', protocol: 'gt06', retentionDays: 90 }))
          .find((vehicle) => vehicle.deviceId === deviceId),
      ),
    ),
    createDevice: vi.fn().mockResolvedValue({ deviceId: 'new' }),
    updateDevice: vi.fn().mockResolvedValue({ deviceId: 'north-van' }),
    deleteDevice: vi.fn(),
    listDrivers: vi.fn(),
    getDriver: vi.fn(),
    createDriver: vi.fn(),
    updateDriver: vi.fn(),
    deleteDriver: vi.fn(),
    positions: vi.fn().mockResolvedValue([]),
    events: vi.fn().mockResolvedValue([]),
    trips: vi.fn().mockResolvedValue([]),
    dailyStats: vi.fn().mockResolvedValue([]),
    tenantEvents: vi.fn().mockResolvedValue([]),
    createCommand: vi.fn().mockResolvedValue({ commandId: 'c1' }),
  };
}

function user(userId: string, role: Role, extra: Partial<FleetUser> = {}): FleetUser {
  return { tenantId: 'tenant-a', userId, role, enabled: true, groupIds: [], ...extra };
}

function adminStore(users: FleetUser[] = [user('user-1', 'admin'), user('user-2', 'viewer')]) {
  return {
    listGroups: vi.fn().mockResolvedValue([
      { tenantId: 'tenant-a', groupId: 'north', name: 'North depot' },
      { tenantId: 'tenant-a', groupId: 'south', name: 'South depot' },
    ]),
    getGroup: vi.fn(),
    createGroup: vi.fn((_tenant: string, input: object) =>
      Promise.resolve({ ...input, groupId: 'g-new' } as Group),
    ),
    updateGroup: vi.fn().mockResolvedValue({ groupId: 'north', name: 'Renamed' }),
    deleteGroup: vi.fn().mockResolvedValue(true),
    listGeofences: vi.fn().mockResolvedValue([]),
    createGeofence: vi.fn((_tenant: string, input: object) =>
      Promise.resolve({ ...input, geofenceId: 'f-new' } as Geofence),
    ),
    updateGeofence: vi.fn().mockResolvedValue({ geofenceId: 'f1' }),
    deleteGeofence: vi.fn().mockResolvedValue(true),
    listUsers: vi.fn().mockResolvedValue(users),
    getUser: vi.fn((_tenant: string, userId: string) =>
      Promise.resolve(users.find((item) => item.userId === userId)),
    ),
    updateUser: vi.fn((_tenant: string, userId: string, changes: object) =>
      Promise.resolve({ ...users.find((item) => item.userId === userId), ...changes } as FleetUser),
    ),
    createUser: vi.fn((tenantId: string, input: object) =>
      Promise.resolve({ ...input, tenantId, userId: 'user-new', enabled: true } as FleetUser),
    ),
    deleteUser: vi.fn().mockResolvedValue({ subject: 'sub-2' }),
  };
}

function activityStore() {
  return {
    organisation: vi.fn(),
    updateOrganisation: vi.fn(),
    append: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    listAlerts: vi.fn().mockResolvedValue([
      { alertId: 'a-north', deviceId: 'north-van' },
      { alertId: 'a-south', deviceId: 'south-bus' },
    ]),
    getAlert: vi.fn().mockResolvedValue({ alertId: 'a-south', deviceId: 'south-bus' }),
    acknowledgeAlert: vi.fn().mockResolvedValue({ status: 'acknowledged' }),
  };
}

function directory() {
  return {
    invite: vi.fn().mockResolvedValue('sub-new'),
    setEnabled: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

function handlerFor(
  dependencies = fleet(),
  admin = adminStore(),
  activity = activityStore(),
  identity = directory(),
) {
  return createHandler(dependencies, undefined, undefined, activity, undefined, {
    admin,
    identity,
  });
}

const body = (result: { body: string }) => JSON.parse(result.body) as Record<string, unknown>;
const ALERT_ID = '01J9ZQ3X9K8J7H6G5F4E3D2C1B';

describe('groups', () => {
  it('lets administrators create, rename and delete groups', async () => {
    const admin = adminStore();
    const handler = handlerFor(fleet(), admin);
    const created = await handler(request('POST', '/groups', { name: '  West depot ' }));
    expect(created.statusCode).toBe(201);
    expect(admin.createGroup).toHaveBeenCalledWith('tenant-a', { name: 'West depot' });
    expect((await handler(request('PATCH', '/groups/north', { name: 'N' }))).statusCode).toBe(200);
    expect((await handler(request('PATCH', '/groups/north', {}))).statusCode).toBe(400);
  });

  it('keeps dispatchers and viewers from changing groups', async () => {
    const handler = handlerFor(fleet('dispatcher'));
    expect((await handler(request('POST', '/groups', { name: 'X' }))).statusCode).toBe(403);
    expect((await handler(request('DELETE', '/groups/north'))).statusCode).toBe(403);
  });

  it('moves vehicles to ungrouped and unassigns users when a group is deleted', async () => {
    const dependencies = fleet();
    const admin = adminStore([
      user('user-1', 'admin'),
      user('user-3', 'dispatcher', { groupIds: ['north', 'south'] }),
    ]);
    const result = await handlerFor(dependencies, admin)(request('DELETE', '/groups/north'));
    expect(result.statusCode).toBe(204);
    expect(dependencies.updateDevice).toHaveBeenCalledTimes(1);
    expect(dependencies.updateDevice).toHaveBeenCalledWith('tenant-a', 'north-van', {
      groupId: 'UNGROUPED',
    });
    expect(admin.updateUser).toHaveBeenCalledWith('tenant-a', 'user-3', { groupIds: ['south'] });
  });

  it('touches nothing when the group does not exist', async () => {
    const dependencies = fleet();
    const admin = adminStore();
    admin.deleteGroup.mockResolvedValue(false);
    const result = await handlerFor(dependencies, admin)(request('DELETE', '/groups/gone'));
    expect(result.statusCode).toBe(404);
    expect(dependencies.updateDevice).not.toHaveBeenCalled();
  });

  it('shows a limited user only their own groups', async () => {
    const result = await handlerFor(fleet('viewer', ['south']))(request('GET', '/groups'));
    expect((body(result).items as Array<{ groupId: string }>).map((g) => g.groupId)).toEqual([
      'south',
    ]);
  });
});

describe('geofences', () => {
  const circle = { type: 'circle', center: { latitude: 12.97, longitude: 77.59 }, radiusM: 250 };

  it('saves circles and polygons in the shape fleet processing reads', async () => {
    const admin = adminStore();
    const handler = handlerFor(fleet(), admin);
    const polygon = {
      type: 'polygon',
      points: [
        { latitude: 12.9, longitude: 77.5 },
        { latitude: 12.9, longitude: 77.6 },
        { latitude: 13, longitude: 77.6 },
      ],
    };
    for (const shape of [circle, polygon]) {
      const result = await handler(request('POST', '/geofences', { name: 'Depot', shape }));
      expect(result.statusCode).toBe(201);
    }
    expect(admin.createGeofence).toHaveBeenLastCalledWith('tenant-a', {
      name: 'Depot',
      description: undefined,
      shape: polygon,
    });
  });

  it('rejects shapes processing could not evaluate', async () => {
    const handler = handlerFor();
    for (const shape of [
      { ...circle, radiusM: 1 },
      { ...circle, center: { latitude: 95, longitude: 0 } },
      { type: 'polygon', points: [{ latitude: 1, longitude: 1 }] },
      {
        type: 'polygon',
        points: Array.from({ length: 101 }, (_, i) => ({ latitude: i / 1000, longitude: 0 })),
      },
      { type: 'line', points: [] },
    ]) {
      const result = await handler(request('POST', '/geofences', { name: 'Bad', shape }));
      expect(result.statusCode).toBe(400);
    }
  });

  it('stops at the per-fleet limit', async () => {
    const admin = adminStore();
    admin.listGeofences.mockResolvedValue(Array.from({ length: MAX_GEOFENCES }, () => ({})));
    const result = await handlerFor(
      fleet(),
      admin,
    )(request('POST', '/geofences', { name: 'One more', shape: circle }));
    expect(result.statusCode).toBe(409);
    expect(admin.createGeofence).not.toHaveBeenCalled();
  });

  it('lets everyone list but only administrators change them', async () => {
    const handler = handlerFor(fleet('viewer'));
    expect((await handler(request('GET', '/geofences'))).statusCode).toBe(200);
    expect(
      (await handler(request('POST', '/geofences', { name: 'X', shape: circle }))).statusCode,
    ).toBe(403);
    expect((await handler(request('DELETE', '/geofences/f1'))).statusCode).toBe(403);
  });

  it('reports a missing geofence', async () => {
    const admin = adminStore();
    admin.deleteGeofence.mockResolvedValue(false);
    admin.updateGeofence.mockResolvedValue(undefined);
    const handler = handlerFor(fleet(), admin);
    expect((await handler(request('DELETE', '/geofences/f9'))).statusCode).toBe(404);
    expect((await handler(request('PATCH', '/geofences/f9', { name: 'Y' }))).statusCode).toBe(404);
  });
});

describe('users', () => {
  it('lists users for administrators only', async () => {
    expect((await handlerFor()(request('GET', '/users'))).statusCode).toBe(200);
    expect((await handlerFor(fleet('dispatcher'))(request('GET', '/users'))).statusCode).toBe(403);
  });

  it('changes role, groups and access, removing duplicate groups', async () => {
    const admin = adminStore();
    const result = await handlerFor(
      fleet(),
      admin,
    )(request('PATCH', '/users/user-2', { role: 'dispatcher', groupIds: ['north', 'north'] }));
    expect(result.statusCode).toBe(200);
    expect(admin.updateUser).toHaveBeenCalledWith('tenant-a', 'user-2', {
      role: 'dispatcher',
      groupIds: ['north'],
    });
  });

  it('rejects groups that do not exist', async () => {
    const result = await handlerFor()(request('PATCH', '/users/user-2', { groupIds: ['nowhere'] }));
    expect(result.statusCode).toBe(400);
  });

  it('stops administrators locking themselves or the fleet out', async () => {
    const handler = handlerFor();
    for (const change of [{ role: 'viewer' }, { enabled: false }]) {
      const result = await handler(request('PATCH', '/users/user-1', change));
      expect(result.statusCode).toBe(400);
    }
    const lastAdmin = adminStore([user('user-1', 'admin'), user('user-2', 'admin')]);
    lastAdmin.listUsers.mockResolvedValue([
      user('user-1', 'admin', { enabled: false }),
      user('user-2', 'admin'),
    ]);
    const demoted = await handlerFor(
      fleet(),
      lastAdmin,
    )(request('PATCH', '/users/user-2', { role: 'viewer' }));
    expect(demoted.statusCode).toBe(400);
    expect(lastAdmin.updateUser).not.toHaveBeenCalled();
  });

  it('reports an unknown user', async () => {
    const result = await handlerFor()(request('PATCH', '/users/user-9', { enabled: false }));
    expect(result.statusCode).toBe(404);
  });
});

describe('vehicles in groups', () => {
  it('only accepts existing groups for new and edited vehicles', async () => {
    const dependencies = fleet();
    const handler = handlerFor(dependencies);
    const input = { name: 'Van', uniqueId: '123456789', protocol: 'gt06' };
    expect(
      (await handler(request('POST', '/devices', { ...input, groupId: 'nowhere' }))).statusCode,
    ).toBe(400);
    expect(
      (await handler(request('POST', '/devices', { ...input, groupId: 'north' }))).statusCode,
    ).toBe(201);
    expect(
      (await handler(request('PATCH', '/devices/spare-car', { groupId: 'nowhere' }))).statusCode,
    ).toBe(400);
  });

  it('moves a vehicle out of its group with null', async () => {
    const dependencies = fleet();
    await handlerFor(dependencies)(request('PATCH', '/devices/north-van', { groupId: null }));
    expect(dependencies.updateDevice).toHaveBeenCalledWith('tenant-a', 'north-van', {
      groupId: 'UNGROUPED',
    });
  });
});

describe('group-limited access', () => {
  const north = () => fleet('dispatcher', ['north']);

  it('lists only vehicles in the user’s groups', async () => {
    const result = await handlerFor(north())(request('GET', '/devices'));
    expect((body(result).items as Array<{ deviceId: string }>).map((d) => d.deviceId)).toEqual([
      'north-van',
    ]);
  });

  it('treats other groups’ vehicles as missing everywhere', async () => {
    const dependencies = north();
    const handler = handlerFor(dependencies);
    for (const path of [
      '/devices/south-bus/positions',
      '/devices/south-bus/events',
      '/devices/south-bus/summary',
      '/devices/spare-car/trips',
    ]) {
      expect((await handler(request('GET', path))).statusCode).toBe(404);
    }
    const command = await handler(
      request('POST', '/devices/south-bus/commands', { type: 'custom' }),
    );
    expect(command.statusCode).toBe(404);
    expect(dependencies.createCommand).not.toHaveBeenCalled();
    expect((await handler(request('GET', '/devices/north-van/positions'))).statusCode).toBe(200);
  });

  it('filters fleet-wide trips and alerts', async () => {
    const dependencies = north();
    const handler = handlerFor(dependencies);
    await handler(request('GET', '/trips'));
    expect(dependencies.trips).toHaveBeenCalledTimes(1);
    expect(dependencies.trips.mock.calls[0]?.[1]).toBe('north-van');
    const alerts = await handler(request('GET', '/alerts'));
    expect((body(alerts).items as Array<{ alertId: string }>).map((a) => a.alertId)).toEqual([
      'a-north',
    ]);
  });

  it('cannot acknowledge an alert from another group', async () => {
    const activity = activityStore();
    const result = await handlerFor(
      north(),
      adminStore(),
      activity,
    )(request('PATCH', `/alerts/${ALERT_ID}`, { status: 'acknowledged' }));
    expect(result.statusCode).toBe(404);
    expect(activity.acknowledgeAlert).not.toHaveBeenCalled();
  });

  it('leaves administrators and unassigned users with the whole fleet', async () => {
    for (const dependencies of [fleet('admin', ['north']), fleet('dispatcher')]) {
      const result = await handlerFor(dependencies)(request('GET', '/devices'));
      expect(body(result).items).toHaveLength(3);
    }
  });
});

describe('inviting and removing users', () => {
  it('creates the sign-in account, then the fleet user', async () => {
    const admin = adminStore();
    const identity = directory();
    const result = await handlerFor(
      fleet(),
      admin,
      activityStore(),
      identity,
    )(
      request('POST', '/users', {
        email: ' Asha@Example.com ',
        role: 'dispatcher',
        groupIds: ['north'],
      }),
    );
    expect(result.statusCode).toBe(201);
    expect(identity.invite).toHaveBeenCalledWith('asha@example.com');
    expect(admin.createUser).toHaveBeenCalledWith('tenant-a', {
      email: 'asha@example.com',
      role: 'dispatcher',
      groupIds: ['north'],
      subject: 'sub-new',
    });
  });

  it('refuses duplicates, unknown groups and bad input before creating an account', async () => {
    const identity = directory();
    const admin = adminStore([user('user-1', 'admin', { email: 'asha@example.com' })]);
    const handler = handlerFor(fleet(), admin, activityStore(), identity);
    const cases: Array<[unknown, number]> = [
      [{ email: 'ASHA@example.com', role: 'viewer' }, 409],
      [{ email: 'new@example.com', role: 'viewer', groupIds: ['nowhere'] }, 400],
      [{ email: 'not-an-email', role: 'viewer' }, 400],
      [{ email: 'new@example.com', role: 'owner' }, 400],
    ];
    for (const [input, status] of cases)
      expect((await handler(request('POST', '/users', input))).statusCode).toBe(status);
    expect(identity.invite).not.toHaveBeenCalled();
  });

  it('removes the account again when saving the user fails', async () => {
    const admin = adminStore();
    admin.createUser.mockRejectedValue(new Error('throttled'));
    const identity = directory();
    const result = await handlerFor(
      fleet(),
      admin,
      activityStore(),
      identity,
    )(request('POST', '/users', { email: 'new@example.com', role: 'viewer' }));
    expect(result.statusCode).toBe(503);
    expect(identity.remove).toHaveBeenCalledWith('sub-new');
  });

  it('reports an email that already has an account elsewhere', async () => {
    const { AccountExistsError } = await import('../src/aws');
    const identity = directory();
    identity.invite.mockRejectedValue(
      new AccountExistsError('an account with this email already exists'),
    );
    const result = await handlerFor(
      fleet(),
      adminStore(),
      activityStore(),
      identity,
    )(request('POST', '/users', { email: 'new@example.com', role: 'viewer' }));
    expect(result.statusCode).toBe(409);
  });

  it('deletes the user and their account, but never yourself or the last admin', async () => {
    const identity = directory();
    const admin = adminStore();
    const handler = handlerFor(fleet(), admin, activityStore(), identity);
    expect((await handler(request('DELETE', '/users/user-2'))).statusCode).toBe(204);
    expect(identity.remove).toHaveBeenCalledWith('sub-2');
    expect((await handler(request('DELETE', '/users/user-1'))).statusCode).toBe(400);
    expect((await handler(request('DELETE', '/users/user-9'))).statusCode).toBe(404);
  });

  it('disables and re-enables the sign-in account with the user', async () => {
    const identity = directory();
    const admin = adminStore([
      user('user-1', 'admin'),
      user('user-2', 'viewer', { subject: 'sub-2' }),
    ]);
    const handler = handlerFor(fleet(), admin, activityStore(), identity);
    await handler(request('PATCH', '/users/user-2', { enabled: false }));
    await handler(request('PATCH', '/users/user-2', { enabled: true }));
    expect(identity.setEnabled.mock.calls).toEqual([
      ['sub-2', false],
      ['sub-2', true],
    ]);
  });
});

describe('vehicle event settings', () => {
  it('saves thresholds and links, refusing self-links and unknown vehicles', async () => {
    const dependencies = fleet();
    const handler = handlerFor(dependencies);
    const ok = await handler(
      request('PATCH', '/devices/north-van', {
        fuelDropThreshold: 10,
        brakingThresholdMs2: 4,
        proximity: { linkedDeviceIds: ['south-bus'], enterDistanceM: 100 },
      }),
    );
    expect(ok.statusCode).toBe(200);
    expect(dependencies.updateDevice).toHaveBeenCalledWith('tenant-a', 'north-van', {
      fuelDropThreshold: 10,
      brakingThresholdMs2: 4,
      proximity: {
        linkedDeviceIds: ['south-bus'],
        enterDistanceM: 100,
        exitDistanceM: undefined,
        unaccompaniedDistanceM: undefined,
      },
    });
    for (const body of [
      { proximity: { linkedDeviceIds: ['north-van'] } },
      { proximity: { linkedDeviceIds: ['ghost'] } },
      { fuelDropThreshold: 0 },
      { accelerationThresholdMs2: 50 },
    ])
      expect((await handler(request('PATCH', '/devices/north-van', body))).statusCode).toBe(400);
  });

  it('records odometer and engine-hours corrections for processing to apply', async () => {
    const dependencies = fleet();
    const result = await handlerFor(dependencies)(
      request('POST', '/devices/north-van/accumulators', { odometerM: 125_000_000 }),
    );
    expect(result.statusCode).toBe(202);
    expect(dependencies.updateDevice).toHaveBeenCalledWith('tenant-a', 'north-van', {
      accumulators: { odometerM: 125_000_000, setAt: expect.any(Number) as number },
    });
    expect(
      (await handlerFor()(request('POST', '/devices/north-van/accumulators', {}))).statusCode,
    ).toBe(400);
  });

  it('keeps RFID cards unique across drivers', async () => {
    const dependencies = fleet();
    dependencies.listDrivers.mockResolvedValue([{ driverId: 'd1', name: 'Asha', rfid: 'CARD-1' }]);
    dependencies.createDriver.mockResolvedValue({ driverId: 'd2' });
    dependencies.updateDriver.mockResolvedValue({ driverId: 'd1' });
    const handler = handlerFor(dependencies);
    expect(
      (await handler(request('POST', '/drivers', { name: 'Ravi', rfid: 'CARD-1' }))).statusCode,
    ).toBe(409);
    expect(
      (await handler(request('POST', '/drivers', { name: 'Ravi', rfid: 'CARD-2' }))).statusCode,
    ).toBe(201);
    expect((await handler(request('PATCH', '/drivers/d1', { rfid: 'CARD-1' }))).statusCode).toBe(
      200,
    );
  });
});

describe('audit trail', () => {
  it('records successful changes, never reads or failures, and survives a failing log', async () => {
    const audit = { record: vi.fn().mockResolvedValue(undefined), list: vi.fn() };
    const handler = createHandler(fleet(), undefined, undefined, activityStore(), undefined, {
      admin: adminStore(),
      identity: directory(),
      audit,
    });
    await handler(request('POST', '/groups', { name: 'West' }));
    await handler(request('GET', '/groups'));
    await handler(request('POST', '/groups', {}));
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith('tenant-a', {
      at: expect.any(Number) as number,
      userId: 'user-1',
      email: undefined,
      method: 'POST',
      path: '/groups',
      status: 201,
    });
    audit.record.mockRejectedValue(new Error('throttled'));
    expect((await handler(request('POST', '/groups', { name: 'East' }))).statusCode).toBe(201);
  });
});

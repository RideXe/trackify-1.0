import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
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
const { createHandler } = await import('../src/handler');

function event(method: string, rawPath: string, sub = 'user-1') {
  return {
    rawPath,
    headers: {},
    requestContext: {
      http: { method },
      authorizer: { jwt: { claims: { sub }, scopes: [] } },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

function eventWithBody(method: string, rawPath: string, body: unknown) {
  return { ...event(method, rawPath), body: JSON.stringify(body) };
}

function store(role: 'admin' | 'viewer' = 'admin') {
  return {
    membership: vi.fn().mockResolvedValue({ tenantId: 'tenant-a', userId: 'user-1', role }),
    listDevices: vi.fn().mockResolvedValue([{ deviceId: 'device-1' }]),
    createDevice: vi.fn().mockResolvedValue({
      deviceId: 'device-2',
      name: 'Demo Car',
      uniqueId: 'phone-demo-1',
      protocol: 'osmand',
      retentionDays: 90,
    }),
    getDevice: vi.fn().mockResolvedValue({
      deviceId: 'device-1',
      name: 'Demo Car',
      uniqueId: 'phone-demo-1',
      protocol: 'osmand',
      retentionDays: 90,
    }),
    positions: vi.fn().mockResolvedValue([{ fixTime: 1 }]),
    events: vi.fn().mockResolvedValue([]),
    trips: vi.fn().mockResolvedValue([]),
    dailyStats: vi.fn().mockResolvedValue([]),
    createCommand: vi.fn().mockResolvedValue({ commandId: 'command-1' }),
    updateDevice: vi.fn().mockResolvedValue({ deviceId: 'device-1', vehicleType: 'bus' }),
    deleteDevice: vi.fn().mockResolvedValue(true),
    listDrivers: vi.fn().mockResolvedValue([{ driverId: 'driver-1', name: 'Ramesh Kumar' }]),
    getDriver: vi.fn().mockResolvedValue({ driverId: 'driver-1', name: 'Ramesh Kumar' }),
    createDriver: vi.fn().mockResolvedValue({ driverId: 'driver-2', name: 'New Driver' }),
    updateDriver: vi.fn().mockResolvedValue({ driverId: 'driver-1', name: 'Renamed Driver' }),
    deleteDriver: vi.fn().mockResolvedValue(true),
  };
}

describe('vehicle types', () => {
  const input = { name: 'School Bus 4', uniqueId: 'phone-bus-4', protocol: 'gt06' };

  it('saves a chosen type and defaults new vehicles to car', async () => {
    const dependencies = store();
    const handler = createHandler(dependencies);
    await handler(eventWithBody('POST', '/devices', { ...input, vehicleType: 'schoolBus' }));
    await handler(eventWithBody('POST', '/devices', input));
    expect(
      dependencies.createDevice.mock.calls.map(
        (call) => (call[1] as { vehicleType: string }).vehicleType,
      ),
    ).toEqual(['schoolBus', 'car']);
  });

  it('rejects a type that is not listed', async () => {
    const result = await createHandler(store())(
      eventWithBody('POST', '/devices', { ...input, vehicleType: 'spaceship' }),
    );
    expect(result.statusCode).toBe(400);
  });

  it('lets administrators change a vehicle type', async () => {
    const dependencies = store();
    const result = await createHandler(dependencies)(
      eventWithBody('PATCH', '/devices/device-1', { vehicleType: 'bus' }),
    );
    expect(result.statusCode).toBe(200);
    expect(dependencies.updateDevice).toHaveBeenCalledWith('tenant-a', 'device-1', {
      vehicleType: 'bus',
    });
  });

  it('keeps vehicle changes admin-only, validated and tenant-scoped', async () => {
    const viewer = store('viewer');
    const denied = await createHandler(viewer)(
      eventWithBody('PATCH', '/devices/device-1', { vehicleType: 'bus' }),
    );
    expect(denied.statusCode).toBe(403);
    expect(viewer.updateDevice).not.toHaveBeenCalled();

    const empty = await createHandler(store())(eventWithBody('PATCH', '/devices/device-1', {}));
    expect(empty.statusCode).toBe(400);

    const missing = store();
    missing.updateDevice.mockResolvedValue(undefined);
    const notFound = await createHandler(missing)(
      eventWithBody('PATCH', '/devices/other-tenant-device', { vehicleType: 'bus' }),
    );
    expect(notFound.statusCode).toBe(404);
  });
});

describe('vehicle details', () => {
  it('saves admin-entered details and clears a field sent as null', async () => {
    const dependencies = store();
    const result = await createHandler(dependencies)(
      eventWithBody('PATCH', '/devices/device-1', {
        model: 'Innova Crysta 2.4 GX',
        fuelType: 'diesel',
        purchasedOn: '2024-02-29',
        colour: null,
      }),
    );
    expect(result.statusCode).toBe(200);
    expect(dependencies.updateDevice).toHaveBeenCalledWith('tenant-a', 'device-1', {
      model: 'Innova Crysta 2.4 GX',
      fuelType: 'diesel',
      purchasedOn: '2024-02-29',
      colour: null,
    });
  });

  it('rejects an unknown fuel type and a date that is not on the calendar', async () => {
    for (const body of [{ fuelType: 'unleaded' }, { purchasedOn: '2026-02-30' }]) {
      const dependencies = store();
      const result = await createHandler(dependencies)(
        eventWithBody('PATCH', '/devices/device-1', body),
      );
      expect(result.statusCode).toBe(400);
      expect(dependencies.updateDevice).not.toHaveBeenCalled();
    }
  });
});

describe('assigning a driver', () => {
  it('assigns a driver that exists in the same tenant', async () => {
    const dependencies = store();
    const result = await createHandler(dependencies)(
      eventWithBody('PATCH', '/devices/device-1', { driverId: 'driver-1' }),
    );
    expect(result.statusCode).toBe(200);
    expect(dependencies.getDriver).toHaveBeenCalledWith('tenant-a', 'driver-1');
    expect(dependencies.updateDevice).toHaveBeenCalledWith('tenant-a', 'device-1', {
      driverId: 'driver-1',
    });
  });

  it('refuses a driver that does not exist, e.g. from another tenant', async () => {
    const dependencies = store();
    dependencies.getDriver.mockResolvedValue(undefined);
    const result = await createHandler(dependencies)(
      eventWithBody('PATCH', '/devices/device-1', { driverId: 'other-tenant-driver' }),
    );
    expect(result.statusCode).toBe(400);
    expect(dependencies.updateDevice).not.toHaveBeenCalled();
  });

  it('unassigns with null without looking up a driver', async () => {
    const dependencies = store();
    await createHandler(dependencies)(
      eventWithBody('PATCH', '/devices/device-1', { driverId: null }),
    );
    expect(dependencies.getDriver).not.toHaveBeenCalled();
    expect(dependencies.updateDevice).toHaveBeenCalledWith('tenant-a', 'device-1', {
      driverId: null,
    });
  });
});

describe('drivers', () => {
  it('lists drivers for the caller tenant, viewers included', async () => {
    const dependencies = store('viewer');
    const result = await createHandler(dependencies)(event('GET', '/drivers'));
    expect(result.statusCode).toBe(200);
    expect(dependencies.listDrivers).toHaveBeenCalledWith('tenant-a');
  });

  it('lets administrators add a driver with only the details they entered', async () => {
    const dependencies = store();
    const result = await createHandler(dependencies)(
      eventWithBody('POST', '/drivers', { name: 'Ramesh Kumar', phone: '+91 98450 12345' }),
    );
    expect(result.statusCode).toBe(201);
    expect(dependencies.createDriver).toHaveBeenCalledWith('tenant-a', {
      name: 'Ramesh Kumar',
      phone: '+91 98450 12345',
      licenceNumber: undefined,
    });
  });

  it('keeps driver changes admin-only and validated', async () => {
    const viewer = store('viewer');
    for (const request of [
      eventWithBody('POST', '/drivers', { name: 'Someone' }),
      eventWithBody('PATCH', '/drivers/driver-1', { name: 'Someone' }),
      event('DELETE', '/drivers/driver-1'),
    ]) {
      expect((await createHandler(viewer)(request)).statusCode).toBe(403);
    }
    expect(viewer.createDriver).not.toHaveBeenCalled();
    expect(viewer.updateDriver).not.toHaveBeenCalled();
    expect(viewer.deleteDriver).not.toHaveBeenCalled();

    const nameless = await createHandler(store())(eventWithBody('POST', '/drivers', {}));
    expect(nameless.statusCode).toBe(400);
    const empty = await createHandler(store())(eventWithBody('PATCH', '/drivers/driver-1', {}));
    expect(empty.statusCode).toBe(400);
  });

  it('clears an optional driver detail sent as null', async () => {
    const dependencies = store();
    const result = await createHandler(dependencies)(
      eventWithBody('PATCH', '/drivers/driver-1', { phone: null }),
    );
    expect(result.statusCode).toBe(200);
    expect(dependencies.updateDriver).toHaveBeenCalledWith('tenant-a', 'driver-1', {
      phone: null,
    });
  });

  it('unassigns a removed driver from only the vehicles they drove', async () => {
    const dependencies = store();
    dependencies.listDevices.mockResolvedValue([
      { deviceId: 'device-1', driverId: 'driver-1' },
      { deviceId: 'device-2', driverId: 'driver-9' },
      { deviceId: 'device-3' },
    ]);
    const result = await createHandler(dependencies)(event('DELETE', '/drivers/driver-1'));
    expect(result.statusCode).toBe(204);
    expect(dependencies.deleteDriver).toHaveBeenCalledWith('tenant-a', 'driver-1');
    expect(dependencies.updateDevice).toHaveBeenCalledTimes(1);
    expect(dependencies.updateDevice).toHaveBeenCalledWith('tenant-a', 'device-1', {
      driverId: null,
    });
  });

  it('reports a missing driver without touching any vehicle', async () => {
    const dependencies = store();
    dependencies.deleteDriver.mockResolvedValue(false);
    dependencies.updateDriver.mockResolvedValue(undefined);
    expect((await createHandler(dependencies)(event('DELETE', '/drivers/nope'))).statusCode).toBe(
      404,
    );
    expect(
      (
        await createHandler(dependencies)(
          eventWithBody('PATCH', '/drivers/nope', { name: 'Someone' }),
        )
      ).statusCode,
    ).toBe(404);
    expect(dependencies.updateDevice).not.toHaveBeenCalled();
  });
});

describe('deleting a vehicle', () => {
  it('lets an administrator remove a vehicle', async () => {
    const dependencies = store();
    const result = await createHandler(dependencies)(event('DELETE', '/devices/device-1'));
    expect(result.statusCode).toBe(204);
    expect(dependencies.deleteDevice).toHaveBeenCalledWith('tenant-a', 'device-1');
  });

  it('is admin-only and tenant-scoped, and reports a missing vehicle', async () => {
    const viewer = store('viewer');
    const denied = await createHandler(viewer)(event('DELETE', '/devices/device-1'));
    expect(denied.statusCode).toBe(403);
    expect(viewer.deleteDevice).not.toHaveBeenCalled();

    const missing = store();
    missing.deleteDevice.mockResolvedValue(false);
    const notFound = await createHandler(missing)(event('DELETE', '/devices/other-tenant-device'));
    expect(notFound.statusCode).toBe(404);
  });
});

describe('fleet API', () => {
  it('derives tenant scope from membership', async () => {
    const dependencies = store();
    const result = await createHandler(dependencies)(event('GET', '/devices'));
    expect(result.statusCode).toBe(200);
    expect(dependencies.listDevices).toHaveBeenCalledWith('tenant-a');
  });

  it('does not allow a viewer to create a device', async () => {
    const dependencies = store('viewer');
    const result = await createHandler(dependencies)(event('POST', '/devices'));
    expect(result.statusCode).toBe(403);
    expect(dependencies.createDevice).not.toHaveBeenCalled();
  });

  it('checks device ownership through the tenant-scoped store', async () => {
    const dependencies = store();
    const result = await createHandler(dependencies)(event('GET', '/devices/device-1/positions'));
    expect(result.statusCode).toBe(200);
    expect(dependencies.positions).toHaveBeenCalledWith(
      'tenant-a',
      'device-1',
      expect.any(Number),
      expect.any(Number),
      1_000,
    );
  });

  it('reads reports through the tenant-scoped store', async () => {
    const dependencies = store();
    const result = await createHandler(dependencies)(event('GET', '/devices/device-1/trips'));
    expect(result.statusCode).toBe(200);
    expect(dependencies.trips).toHaveBeenCalledWith(
      'tenant-a',
      'device-1',
      expect.any(Number),
      expect.any(Number),
      1_000,
    );
  });

  it('blocks viewers and non-admin engine commands', async () => {
    const viewer = store('viewer');
    const viewerResult = await createHandler(viewer)(
      eventWithBody('POST', '/devices/device-1/commands', { type: 'custom' }),
    );
    expect(viewerResult.statusCode).toBe(403);
    expect(viewer.createCommand).not.toHaveBeenCalled();

    const dispatcher = store();
    dispatcher.membership.mockResolvedValue({
      tenantId: 'tenant-a',
      userId: 'user-1',
      role: 'dispatcher',
    });
    const engineResult = await createHandler(dispatcher)(
      eventWithBody('POST', '/devices/device-1/commands', { type: 'engineStop' }),
    );
    expect(engineResult.statusCode).toBe(400);
    expect(dispatcher.createCommand).not.toHaveBeenCalled();
  });

  it('queues short-lived commands for administrators', async () => {
    const dependencies = store();
    const result = await createHandler(dependencies)(
      eventWithBody('POST', '/devices/device-1/commands', {
        type: 'engineStop',
        ttlSeconds: 60,
      }),
    );
    expect(result.statusCode).toBe(202);
    expect(dependencies.createCommand).toHaveBeenCalledWith(
      'tenant-a',
      'device-1',
      'user-1',
      'engineStop',
      {},
      expect.any(Number),
    );
  });
});

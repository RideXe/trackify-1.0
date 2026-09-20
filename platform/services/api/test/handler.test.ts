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
  };
}

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

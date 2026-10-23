import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import type { ComputedAttributeRecord, Maintenance } from '@trackify/data';
import { describe, expect, it, vi } from 'vitest';
import { createConfigRoutes, type ConfigStore } from '../src/config-routes';
import { InputError } from '../src/http';

function request(method: string, rawPath: string, body?: unknown) {
  return {
    rawPath,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { http: { method } },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

const membership = (role: 'admin' | 'viewer' = 'admin') => ({
  tenantId: 't',
  userId: 'u',
  role,
  groupIds: [],
});

function store() {
  return {
    listComputed: vi.fn().mockResolvedValue([]),
    createComputed: vi.fn((tenantId: string, input: object) =>
      Promise.resolve({ ...input, tenantId, attributeId: 'c1' } as ComputedAttributeRecord),
    ),
    updateComputed: vi.fn().mockResolvedValue({ attributeId: 'c1' }),
    deleteComputed: vi.fn().mockResolvedValue(true),
    listMaintenances: vi.fn().mockResolvedValue([]),
    createMaintenance: vi.fn((tenantId: string, input: object) =>
      Promise.resolve({ ...input, tenantId, maintenanceId: 'm1' } as Maintenance),
    ),
    updateMaintenance: vi.fn().mockResolvedValue({ maintenanceId: 'm1' }),
    deleteMaintenance: vi.fn().mockResolvedValue(true),
  } satisfies ConfigStore;
}

const latest = {
  latest: vi.fn().mockResolvedValue({
    fixTime: 5,
    speedKmh: 40,
    attributes: { io: { 'io.66': 12_480 } },
  }),
};

async function call(
  routes: ReturnType<typeof createConfigRoutes>,
  ...args: Parameters<typeof routes>
) {
  try {
    return await routes(...args);
  } catch (error) {
    if (error instanceof InputError) return { statusCode: 400, body: error.message };
    throw error;
  }
}

describe('computed attributes', () => {
  it('saves a valid expression with defaults', async () => {
    const config = store();
    const result = await call(
      createConfigRoutes(config, latest),
      request('POST', '/computed-attributes', {
        attribute: 'powerV',
        expression: 'io66 * 0.001',
        type: 'number',
      }),
      membership(),
    );
    expect(result?.statusCode).toBe(201);
    expect(config.createComputed).toHaveBeenCalledWith('t', {
      attribute: 'powerV',
      expression: 'io66 * 0.001',
      type: 'number',
      order: 0,
      deviceIds: [],
      groupIds: [],
    });
  });

  it('rejects broken expressions and mismatched types for known attributes', async () => {
    const routes = createConfigRoutes(store(), latest);
    for (const body of [
      { attribute: 'powerV', expression: 'io66 *', type: 'number' },
      { attribute: 'ignition', expression: '1', type: 'number' },
      { attribute: 'bad name', expression: '1', type: 'number' },
      { attribute: 'x', expression: '1', type: 'date' },
    ]) {
      const result = await call(
        routes,
        request('POST', '/computed-attributes', body),
        membership(),
      );
      expect(result?.statusCode, JSON.stringify(body)).toBe(400);
    }
  });

  it('tests an expression against the vehicle’s latest position', async () => {
    const result = await call(
      createConfigRoutes(store(), latest),
      request('POST', '/computed-attributes/test', {
        deviceId: 'van',
        expression: 'io66 / 1000 + speed',
      }),
      membership(),
    );
    const body = JSON.parse(result!.body) as { value: number; fixTime: number };
    expect(body.value).toBeCloseTo(52.48);
    expect(body.fixTime).toBe(5);
  });

  it('is for administrators', async () => {
    const result = await call(
      createConfigRoutes(store(), latest),
      request('GET', '/computed-attributes'),
      membership('viewer'),
    );
    expect(result?.statusCode).toBe(403);
  });
});

describe('maintenance', () => {
  it('saves schedules on odometer, engine hours or time', async () => {
    const config = store();
    const routes = createConfigRoutes(config, latest);
    const result = await call(
      routes,
      request('POST', '/maintenances', {
        name: 'Oil change',
        type: 'odometerM',
        start: 0,
        period: 10_000_000,
      }),
      membership(),
    );
    expect(result?.statusCode).toBe(201);
    for (const body of [
      { name: 'Bad', type: 'speed', start: 0, period: 1 },
      { name: 'Bad', type: 'odometerM', start: 0, period: 0 },
      { name: 'Bad', type: 'fixTime', start: 0, period: 3_600_000 },
    ])
      expect(
        (await call(routes, request('POST', '/maintenances', body), membership()))?.statusCode,
      ).toBe(400);
  });

  it('lets everyone see schedules', async () => {
    const result = await call(
      createConfigRoutes(store(), latest),
      request('GET', '/maintenances'),
      membership('viewer'),
    );
    expect(result?.statusCode).toBe(200);
  });
});

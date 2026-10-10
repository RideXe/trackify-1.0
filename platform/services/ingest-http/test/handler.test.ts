import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';

process.env.ONBOARDING_TABLE = 'test-onboarding';
process.env.INGEST_QUEUE_URL = 'https://example.test/queue';
const { createHandler } = await import('../src/handler');

const device = {
  codeHash: 'code-hash',
  tenantId: '01J9ZQ3V5X8K2M4N6P7R8S9T0V',
  deviceId: '01J9ZQ3W1A2B3C4D5E6F7G8H9J',
  uniqueId: '359632101234567',
  protocol: 'osmand',
  retentionDays: 90,
  deviceName: 'Demo Car',
  status: 'activated' as const,
  createdAt: 1,
};

function event(query: Record<string, string>): APIGatewayProxyEventV2 {
  return {
    queryStringParameters: query,
    headers: { authorization: 'Bearer valid-device-secret' },
    requestContext: {},
  } as unknown as APIGatewayProxyEventV2;
}

describe('phone HTTP ingest', () => {
  it('queues a compatible OsmAnd position and returns only after acceptance', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const handler = createHandler({
      credentials: { resolveCredential: vi.fn().mockResolvedValue(device) },
      queue: { send, sendAll: vi.fn() },
      now: () => 1_757_836_800_500,
    });
    const result = await handler(
      event({ id: device.uniqueId, lat: '12.9716', lon: '77.5946', timestamp: '1757836800' }),
    );
    expect(result.statusCode).toBe(202);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: device.deviceId,
        fixTime: 1_757_836_800_000,
        retentionDays: 90,
        source: 'http',
      }),
    );
  });

  it('rejects unknown devices and invalid coordinates without queueing', async () => {
    const send = vi.fn();
    const unknown = createHandler({
      credentials: { resolveCredential: vi.fn().mockResolvedValue(undefined) },
      queue: { send, sendAll: vi.fn() },
      now: Date.now,
    });
    expect((await unknown(event({ id: 'nope', lat: '1', lon: '2' }))).statusCode).toBe(401);
    const known = createHandler({
      credentials: { resolveCredential: vi.fn().mockResolvedValue(device) },
      queue: { send, sendAll: vi.fn() },
      now: Date.now,
    });
    expect((await known(event({ id: device.uniqueId, lat: '100', lon: '2' }))).statusCode).toBe(
      400,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('accepts a base64 encoded JSON request body', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const handler = createHandler({
      credentials: { resolveCredential: vi.fn().mockResolvedValue(device) },
      queue: { send, sendAll: vi.fn() },
      now: () => 1_757_836_800_500,
    });
    const result = await handler({
      ...event({}),
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer valid-device-secret',
      },
      isBase64Encoded: true,
      body: Buffer.from(
        JSON.stringify({ id: device.uniqueId, lat: 12.9716, lon: 77.5946 }),
      ).toString('base64'),
    });
    expect(result.statusCode).toBe(202);
    expect(send).toHaveBeenCalledOnce();
  });
});

it('accepts nullable optional sensors on a stationary phone', async () => {
  const send = vi.fn().mockResolvedValue(undefined);
  const handler = createHandler({
    credentials: { resolveCredential: vi.fn().mockResolvedValue(device) },
    queue: { send, sendAll: vi.fn() },
    now: Date.now,
  });
  const result = await handler({
    ...event({}),
    headers: { authorization: 'Bearer valid-device-secret', 'content-type': 'application/json' },
    body: JSON.stringify({
      id: device.uniqueId,
      lat: 12.9,
      lon: 77.5,
      speed: 0,
      bearing: null,
      altitude: null,
      accuracy: null,
    }),
  });
  expect(result.statusCode).toBe(202);
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({ latitude: 12.9, longitude: 77.5, speedKmh: 0 }),
  );
});

describe('phone batches (v2)', () => {
  const batchEvent = (body: unknown) =>
    ({
      ...event({}),
      headers: { authorization: 'Bearer valid-device-secret', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as APIGatewayProxyEventV2;
  const point = (t: number, extra = {}) => ({
    t,
    lat: 12.97,
    lon: 77.59,
    acc: 4.2,
    spd: 10,
    brg: 90,
    still: false,
    path: 12.5,
    ...extra,
  });

  function handlerWith(sendAll = vi.fn().mockResolvedValue(undefined)) {
    return {
      sendAll,
      handler: createHandler({
        credentials: { resolveCredential: vi.fn().mockResolvedValue(device) },
        queue: { send: vi.fn(), sendAll },
        now: () => 1_760_000_100_000,
      }),
    };
  }

  it('queues every point in time order with the phone’s motion, path distance and accuracy', async () => {
    const { handler, sendAll } = handlerWith();
    const result = await handler(
      batchEvent({
        v: 2,
        id: device.uniqueId,
        batt: 76,
        points: [
          point(1_760_000_002_000),
          point(1_760_000_001_000, { still: true, spd: 0, path: 0 }),
        ],
        filter: {
          raw: 30,
          kept: 27,
          uploaded: 2,
          rejected: { inaccurate: 3 },
          relocations: 0,
          distanceM: 25,
        },
      }),
    );
    expect(result).toMatchObject({
      statusCode: 202,
      body: JSON.stringify({ accepted: 2, skipped: 0 }),
    });
    const [positions] = sendAll.mock.calls[0] as [Array<Record<string, unknown>>];
    expect(positions.map((position) => position.fixTime)).toEqual([
      1_760_000_001_000, 1_760_000_002_000,
    ]);
    expect(positions[1]).toMatchObject({
      speedKmh: 36,
      accuracyM: 4.2,
      courseDeg: 90,
      attributes: { motion: true, pathDistanceM: 12.5 },
    });
    expect(positions[0]).toMatchObject({ attributes: { motion: false } });
  });

  it('stores the motion-sensor activity, dropping values it does not know', async () => {
    const { handler, sendAll } = handlerWith();
    const result = await handler(
      batchEvent({
        v: 2,
        id: device.uniqueId,
        points: [
          point(1_760_000_001_000, { act: 'foot' }),
          point(1_760_000_002_000, { act: 'hovercraft' }),
          point(1_760_000_003_000),
        ],
      }),
    );
    expect(result).toMatchObject({ body: JSON.stringify({ accepted: 3, skipped: 0 }) });
    const [positions] = sendAll.mock.calls[0] as [Array<{ attributes: { activity?: string } }>];
    expect(positions.map((position) => position.attributes.activity)).toEqual([
      'foot',
      undefined,
      undefined,
    ]);
  });

  it('keeps the filter report and battery on the window’s last point for debugging', async () => {
    const { handler, sendAll } = handlerWith();
    await handler(
      batchEvent({
        v: 2,
        batt: 55,
        points: [point(1), point(2)].map((p, i) => ({ ...p, t: 1_760_000_000_000 + i * 1000 })),
        filter: {
          raw: 30,
          kept: 28,
          uploaded: 2,
          rejected: { spike: 1, 'bad key!': 2 },
          distanceM: 30,
        },
      }),
    );
    const [positions] = sendAll.mock.calls[0] as [Array<{ attributes: Record<string, unknown> }>];
    expect(positions[1]!.attributes).toMatchObject({
      batteryLevelPct: 55,
      io: {
        'filter.raw': 30,
        'filter.kept': 28,
        'filter.uploaded': 2,
        'filter.distanceM': 30,
        'filter.rejected.spike': 1,
      },
    });
    expect(positions[0]!.attributes.io).toBeUndefined();
  });

  it('gives a re-sent point the same id, so retries are not duplicated', async () => {
    const { handler, sendAll } = handlerWith();
    const body = { v: 2, points: [point(1_760_000_001_000)] };
    await handler(batchEvent(body));
    await handler(batchEvent(body));
    const ids = sendAll.mock.calls.map(
      (call) => (call[0] as Array<{ messageId: string }>)[0]!.messageId,
    );
    expect(ids[0]).toBe(ids[1]);
  });

  it('skips bad points, rejects oversized batches and other devices’ ids', async () => {
    const { handler } = handlerWith();
    const mixed = await handler(
      batchEvent({
        v: 2,
        points: [point(1_760_000_001_000), point(1_760_000_002_000, { lat: 200 })],
      }),
    );
    expect(JSON.parse(mixed.body as string)).toEqual({ accepted: 1, skipped: 1 });
    const huge = await handler(
      batchEvent({
        v: 2,
        points: Array.from({ length: 301 }, (_, i) => point(1_760_000_000_000 + i)),
      }),
    );
    expect(huge.statusCode).toBe(400);
    const other = await handler(batchEvent({ v: 2, id: 'someone-else', points: [point(1)] }));
    expect(other.statusCode).toBe(403);
  });
});

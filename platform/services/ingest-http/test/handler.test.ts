import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import type { DeviceDirectory } from '@trackify/data';

process.env.CORE_TABLE = 'test-core';
process.env.INGEST_QUEUE_URL = 'https://example.test/queue';
const { createHandler } = await import('../src/handler');

const device = {
  tenantId: '01J9ZQ3V5X8K2M4N6P7R8S9T0V',
  deviceId: '01J9ZQ3W1A2B3C4D5E6F7G8H9J',
  uniqueId: '359632101234567',
  protocol: 'osmand',
  retentionDays: 90,
};

function event(query: Record<string, string>): APIGatewayProxyEventV2 {
  return {
    queryStringParameters: query,
    headers: {},
    requestContext: {},
  } as APIGatewayProxyEventV2;
}

describe('phone HTTP ingest', () => {
  it('queues a compatible OsmAnd position and returns only after acceptance', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const handler = createHandler({
      devices: { resolve: vi.fn().mockResolvedValue(device) } satisfies DeviceDirectory,
      queue: { send },
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
      devices: { resolve: vi.fn().mockResolvedValue(undefined) },
      queue: { send },
      now: Date.now,
    });
    expect((await unknown(event({ id: 'nope', lat: '1', lon: '2' }))).statusCode).toBe(404);
    const known = createHandler({
      devices: { resolve: vi.fn().mockResolvedValue(device) },
      queue: { send },
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
      devices: { resolve: vi.fn().mockResolvedValue(device) },
      queue: { send },
      now: () => 1_757_836_800_500,
    });
    const result = await handler({
      ...event({}),
      headers: { 'content-type': 'application/json' },
      isBase64Encoded: true,
      body: Buffer.from(
        JSON.stringify({ id: device.uniqueId, lat: 12.9716, lon: 77.5946 }),
      ).toString('base64'),
    });
    expect(result.statusCode).toBe(202);
    expect(send).toHaveBeenCalledOnce();
  });
});

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';

process.env.ONBOARDING_TABLE = 'onboarding';
process.env.API_BASE_URL = 'https://api.example.com';
const { createHandler } = await import('../src/handler');

function event(code: string) {
  return {
    rawPath: `/onboard/${code}/redeem`,
    requestContext: { http: { method: 'POST' } },
  } as APIGatewayProxyEventV2;
}

describe('public onboarding API', () => {
  it('atomically redeems a valid short code and returns a device credential', async () => {
    const redeem = vi.fn().mockResolvedValue({
      deviceId: 'device-1',
      deviceName: 'Demo Car',
      uniqueId: 'phone-device-1',
      retentionDays: 90,
    });
    const handler = createHandler(
      { redeem },
      'https://api.example.com/',
      () => 1000,
      () => 'long-secret',
    );
    const result = await handler(event('ab7mk9'));
    expect(result.statusCode).toBe(200);
    expect(redeem).toHaveBeenCalledWith(
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.any(String),
      1000,
    );
    expect(JSON.parse(result.body ?? '{}')).toEqual({
      deviceId: 'device-1',
      uniqueId: 'phone-device-1',
      name: 'Demo Car',
      endpoint: 'https://api.example.com/phone/positions',
      credential: 'long-secret',
    });
  });

  it('rejects malformed and unavailable codes', async () => {
    const redeem = vi.fn().mockResolvedValue(undefined);
    const handler = createHandler({ redeem }, 'https://api.example.com');
    expect((await handler(event('bad'))).statusCode).toBe(400);
    expect((await handler(event('AB7MK9'))).statusCode).toBe(410);
  });
});

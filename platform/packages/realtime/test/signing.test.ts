import { describe, expect, it } from 'vitest';
import { signedPublishRequest } from '../src/index';

describe('AppSync request signing', () => {
  it('creates a scoped SigV4 publish request without exposing the secret', async () => {
    const request = signedPublishRequest(
      'example.appsync-api.ap-south-1.amazonaws.com',
      'ap-south-1',
      '/fleet/tenant-a',
      { deviceId: 'device-a' },
      { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret', sessionToken: 'token' },
      new Date('2026-09-18T12:34:56.000Z'),
    );
    expect(request.url).toBe('https://example.appsync-api.ap-south-1.amazonaws.com/event');
    expect(request.headers.get('authorization')).toContain(
      'Credential=AKIDEXAMPLE/20260918/ap-south-1/appsync/aws4_request',
    );
    expect(request.headers.get('authorization')).not.toContain('secret');
    expect(await request.json()).toMatchObject({ channel: '/fleet/tenant-a' });
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { PositionMessage } from '@trackify/domain';
import { AppSyncPositionPublisher, signedPublishRequest } from '../src/index';

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

describe('live position fan-out', () => {
  process.env.AWS_ACCESS_KEY_ID = 'AKIDEXAMPLE';
  process.env.AWS_SECRET_ACCESS_KEY = 'secret';
  const position = { tenantId: 'tenant-a', deviceId: 'device-a' } as PositionMessage;

  async function channelsFor(groupId?: string) {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    await new AppSyncPositionPublisher('dns', 'ap-south-1', fetcher).publish(position, groupId);
    return Promise.all(
      fetcher.mock.calls.map(
        async ([request]) => ((await (request as Request).json()) as { channel: string }).channel,
      ),
    );
  }

  it('reaches the fleet channel and, for grouped vehicles, the group channel', async () => {
    expect(await channelsFor('north')).toEqual(['/fleet/tenant-a', '/fleet/tenant-a/groups/north']);
    expect(await channelsFor('UNGROUPED')).toEqual(['/fleet/tenant-a']);
    expect(await channelsFor()).toEqual(['/fleet/tenant-a']);
  });
});

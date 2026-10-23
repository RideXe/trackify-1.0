import { describe, expect, it, vi } from 'vitest';

process.env.CORE_TABLE = 'core';
const { createHandler } = await import('../src/handler');

describe('realtime subscription authorization', () => {
  it('allows only the channel belonging to the authenticated membership', async () => {
    const handler = createHandler({
      membership: vi
        .fn()
        .mockResolvedValue({ tenantId: 'tenant-a', userId: 'user-1', role: 'admin', groupIds: [] }),
    });
    await expect(
      handler({ operation: 'SUBSCRIBE', channel: '/fleet/tenant-a', identity: { sub: 'user-1' } }),
    ).resolves.toBeNull();
    await expect(
      handler({ operation: 'SUBSCRIBE', channel: '/fleet/tenant-b', identity: { sub: 'user-1' } }),
    ).rejects.toMatchObject({ name: 'UnauthorizedException' });
  });

  it('gives a group-limited user only their groups and their own notifications', async () => {
    const handler = createHandler({
      membership: vi.fn().mockResolvedValue({
        tenantId: 'tenant-a',
        userId: 'user-2',
        role: 'dispatcher',
        groupIds: ['north'],
      }),
    });
    const subscribe = (channel: string) =>
      handler({ operation: 'SUBSCRIBE', channel, identity: { sub: 'user-2' } });
    await expect(subscribe('/fleet/tenant-a/groups/north')).resolves.toBeNull();
    await expect(subscribe('/fleet/tenant-a/users/user-2')).resolves.toBeNull();
    for (const channel of [
      '/fleet/tenant-a',
      '/fleet/tenant-a/groups/south',
      '/fleet/tenant-a/users/user-1',
    ])
      await expect(subscribe(channel)).rejects.toMatchObject({ name: 'UnauthorizedException' });
  });
});

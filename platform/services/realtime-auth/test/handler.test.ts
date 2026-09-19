import { describe, expect, it, vi } from 'vitest';

process.env.CORE_TABLE = 'core';
const { createHandler } = await import('../src/handler');

describe('realtime subscription authorization', () => {
  it('allows only the channel belonging to the authenticated membership', async () => {
    const handler = createHandler({
      membership: vi.fn().mockResolvedValue({ tenantId: 'tenant-a' }),
    });
    await expect(
      handler({ operation: 'SUBSCRIBE', channel: '/fleet/tenant-a', identity: { sub: 'user-1' } }),
    ).resolves.toBeNull();
    await expect(
      handler({ operation: 'SUBSCRIBE', channel: '/fleet/tenant-b', identity: { sub: 'user-1' } }),
    ).rejects.toMatchObject({ name: 'UnauthorizedException' });
  });
});

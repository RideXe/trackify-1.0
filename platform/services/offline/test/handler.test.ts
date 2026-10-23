import { describe, expect, it, vi } from 'vitest';

process.env.DEVICE_STATE_TABLE = 'state';
process.env.EVENTS_TABLE = 'events';
process.env.COMMANDS_TABLE = 'commands';
const { createHandler } = await import('../src/handler');

describe('offline sweep', () => {
  it('marks devices quiet beyond the configured cutoff', async () => {
    const markStale = vi.fn().mockResolvedValue(3);
    const expirePending = vi.fn().mockResolvedValue(2);
    await expect(
      createHandler({ markStale }, { expirePending }, () => 1_000_000)(),
    ).resolves.toEqual({
      cutoff: 700_000,
      updated: 3,
      expiredCommands: 2,
    });
    expect(markStale).toHaveBeenCalledWith(700_000, 1_000);
    expect(expirePending).toHaveBeenCalledWith(1_000_000, 1_000);
  });
});

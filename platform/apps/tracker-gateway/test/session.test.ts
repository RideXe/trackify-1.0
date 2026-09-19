import { describe, expect, it, vi } from 'vitest';
import type { DeviceDirectory } from '@trackify/data';
import type { ProtocolDecoder } from '@trackify/protocols';
import { GatewaySession } from '../src/session';

const device = {
  tenantId: '01J9ZQ3V5X8K2M4N6P7R8S9T0V',
  deviceId: '01J9ZQ3W1A2B3C4D5E6F7G8H9J',
  uniqueId: '359632101234567',
  protocol: 'gt06',
  retentionDays: 90,
};

describe('gateway session', () => {
  it('acknowledges a position only after durable queue acceptance', async () => {
    const writes: string[] = [];
    let release = () => {};
    const accepted = new Promise<void>((resolve) => {
      release = resolve;
    });
    const decoder: ProtocolDecoder = {
      protocol: 'gt06',
      push: vi
        .fn()
        .mockReturnValueOnce([
          { kind: 'identity', uniqueId: device.uniqueId, acknowledgement: Buffer.from('login') },
        ])
        .mockReturnValueOnce([
          {
            kind: 'positions',
            acknowledgement: Buffer.from('position'),
            positions: [
              {
                messageId: 'gt06:0123456789abcdef',
                fixTime: 1_757_836_800_000,
                valid: true,
                latitude: 12.9716,
                longitude: 77.5946,
                attributes: {},
              },
            ],
          },
        ]),
    };
    const socket = {
      write: vi.fn((data: Buffer) => {
        writes.push(data.toString());
        return true;
      }),
      destroy: vi.fn(),
    };
    const session = new GatewaySession(
      socket,
      decoder,
      { resolve: vi.fn().mockResolvedValue(device) } satisfies DeviceDirectory,
      { send: vi.fn().mockReturnValue(accepted) },
      () => 1_757_836_800_500,
    );
    session.receive(Buffer.from('login'));
    await session.settled();
    session.receive(Buffer.from('position'));
    await Promise.resolve();
    expect(writes).toEqual(['login']);
    release();
    await session.settled();
    expect(writes).toEqual(['login', 'position']);
  });

  it('closes unknown devices without acknowledging', async () => {
    const socket = { write: vi.fn(), destroy: vi.fn() };
    const decoder: ProtocolDecoder = {
      protocol: 'gt06',
      push: () => [{ kind: 'identity', uniqueId: 'unknown', acknowledgement: Buffer.from([1]) }],
    };
    const session = new GatewaySession(
      socket,
      decoder,
      { resolve: vi.fn().mockResolvedValue(undefined) },
      { send: vi.fn() },
    );
    session.receive(Buffer.from('x'));
    await session.settled();
    expect(socket.write).not.toHaveBeenCalled();
    expect(socket.destroy).toHaveBeenCalled();
  });
});

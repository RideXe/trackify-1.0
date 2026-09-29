import { describe, expect, it, vi } from 'vitest';
import type { DeviceDirectory } from '@trackify/data';
import type { ProtocolDecoder } from '@trackify/protocols';
import type { PositionMessage } from '@trackify/domain';
import { estimateAccuracyFromSatellites, GatewaySession } from '../src/session';

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

  it('fills in an accuracy estimate from satellite count so the drift filter has something to use', async () => {
    const sent: PositionMessage[] = [];
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
            acknowledgement: Buffer.from('ack'),
            positions: [
              {
                messageId: 'gt06:parked-3-sats',
                fixTime: 1_757_836_800_000,
                valid: true,
                latitude: 12.9716,
                longitude: 77.5946,
                attributes: { satellites: 3 },
              },
              {
                messageId: 'gt06:parked-9-sats',
                fixTime: 1_757_836_801_000,
                valid: true,
                latitude: 12.9716,
                longitude: 77.5946,
                attributes: { satellites: 9 },
              },
              {
                messageId: 'gt06:no-satellite-data',
                fixTime: 1_757_836_802_000,
                valid: true,
                latitude: 12.9716,
                longitude: 77.5946,
                attributes: {},
              },
            ],
          },
        ]),
    };
    const session = new GatewaySession(
      { write: vi.fn(), destroy: vi.fn() },
      decoder,
      { resolve: vi.fn().mockResolvedValue(device) } satisfies DeviceDirectory,
      {
        send: (position: PositionMessage) => {
          sent.push(position);
          return Promise.resolve();
        },
      },
      () => 1_757_836_800_500,
    );
    session.receive(Buffer.from('login'));
    await session.settled();
    session.receive(Buffer.from('position'));
    await session.settled();
    // Below the reliable-fix threshold (4 satellites): a wide, conservative estimate.
    expect(sent[0]?.accuracyM).toBe(50);
    // Good satellite lock: a tight estimate.
    expect(sent[1]?.accuracyM).toBe(6);
    // No satellite count reported at all: no estimate to make up, same as before this change.
    expect(sent[2]?.accuracyM).toBeUndefined();
  });
});

describe('estimateAccuracyFromSatellites', () => {
  it('gets less accurate as satellite count drops, and stricter with more satellites', () => {
    const bands = [1, 4, 5, 6, 7, 8, 9, 20].map(estimateAccuracyFromSatellites);
    expect(bands).toEqual([50, 50, 30, 20, 15, 10, 6, 6]);
    for (let i = 1; i < bands.length; i += 1) expect(bands[i]).toBeLessThanOrEqual(bands[i - 1]!);
  });

  it('makes no claim when satellite count is missing or the fix has none', () => {
    expect(estimateAccuracyFromSatellites(undefined)).toBeUndefined();
    expect(estimateAccuracyFromSatellites(0)).toBeUndefined();
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { DeviceDirectory, PendingCommand } from '@trackify/data';
import type { PositionMessage } from '@trackify/domain';
import { Gt06Decoder, crc16X25, encodeGt06Acknowledgement } from '@trackify/protocols';
import { CommandDispatcher, commandResults, type CommandQueue } from '../src/commands';
import { GatewaySession, type SessionRegistry } from '../src/session';

const device = {
  tenantId: '01J9ZQ3V5X8K2M4N6P7R8S9T0V',
  deviceId: '01J9ZQ3W1A2B3C4D5E6F7G8H9J',
  uniqueId: '356314041419858',
  protocol: 'gt06',
  retentionDays: 90,
};

function frame(body: Buffer) {
  const out = Buffer.alloc(2 + 1 + body.length + 2 + 2);
  out.writeUInt16BE(0x7878, 0);
  out[2] = body.length + 2;
  body.copy(out, 3);
  out.writeUInt16BE(crc16X25(out.subarray(2, out.length - 4)), out.length - 4);
  out.writeUInt16BE(0x0d0a, out.length - 2);
  return out;
}
const login = () => frame(Buffer.from('0103563140414198580007', 'hex'));
function location() {
  const body = Buffer.alloc(1 + 18 + 2);
  body[0] = 0x12;
  Buffer.from([26, 10, 12, 4, 30, 0, 0xcc]).copy(body, 1);
  body.writeUInt32BE(Math.round(12.9716 * 1_800_000), 8);
  body.writeUInt32BE(Math.round(77.5946 * 1_800_000), 12);
  body.writeUInt16BE(0x1000 | 0x0400, 17);
  body.writeUInt16BE(8, 19);
  return frame(body);
}
/** Heartbeat: terminal info (ACC on, SOS bits), voltage, GSM, alarm, language, serial. */
const heartbeat = (terminal: number, alarm = 0) =>
  frame(Buffer.from([0x13, terminal, 4, 3, alarm, 2, 0, 9]));
/** 0x15 reply echoing a server flag. */
function reply(flag: number, text: string) {
  const content = Buffer.from(text, 'ascii');
  const body = Buffer.alloc(1 + 1 + 4 + content.length + 2);
  body[0] = 0x15;
  body[1] = 4 + content.length;
  body.writeUInt32BE(flag, 2);
  content.copy(body, 6);
  return frame(body);
}

function connected(now = () => 1_760_000_000_000) {
  const sent: PositionMessage[] = [];
  const writes: Buffer[] = [];
  const registry: SessionRegistry = new Map();
  const results = { delivered: vi.fn().mockResolvedValue(undefined) };
  const session = new GatewaySession(
    { write: vi.fn((data: Buffer) => writes.push(data) > 0), destroy: vi.fn() },
    new Gt06Decoder(),
    { resolve: vi.fn().mockResolvedValue(device) } satisfies DeviceDirectory,
    { send: vi.fn((position: PositionMessage) => Promise.resolve(void sent.push(position))) },
    now,
    registry,
    results,
  );
  return { session, sent, writes, registry, results };
}

const command = (extra: Partial<PendingCommand> = {}): PendingCommand => ({
  pk: 'pk',
  sk: 'sk',
  commandId: 'c1',
  tenantId: device.tenantId,
  deviceId: device.deviceId,
  type: 'engineStop',
  payload: {},
  createdAt: 1_760_000_000_000,
  ...extra,
});

function queue(commands: PendingCommand[]) {
  return {
    pending: vi.fn().mockResolvedValue(commands),
    markSent: vi.fn().mockResolvedValue(true),
    markFailed: vi.fn().mockResolvedValue(true),
    markDelivered: vi.fn().mockResolvedValue(true),
    recordEvent: vi.fn().mockResolvedValue(undefined),
  } satisfies CommandQueue;
}

describe('gateway sessions', () => {
  it('registers on login and leaves the registry when the socket closes', async () => {
    const { session, registry } = connected();
    session.receive(login());
    await session.settled();
    expect(registry.get(device.deviceId)).toBe(session);
    session.close();
    expect(registry.size).toBe(0);
  });

  it('answers heartbeats and reports their SOS at the last known location', async () => {
    const { session, sent, writes } = connected();
    session.receive(login());
    session.receive(location());
    session.receive(heartbeat(0x02)); // ACC on, no alarm: ignition change only
    session.receive(heartbeat(0x02)); // nothing new: no position
    session.receive(heartbeat(0x22, 0x01)); // SOS
    await session.settled();
    expect(writes.at(-1)?.toString('hex')).toBe(encodeGt06Acknowledgement(0x13, 9).toString('hex'));
    expect(sent).toHaveLength(3);
    expect(sent[1]?.attributes.ignition).toBe(true);
    expect(sent[2]).toMatchObject({ latitude: sent[0]?.latitude, attributes: { alarms: ['sos'] } });
    expect(new Set(sent.map((position) => position.messageId)).size).toBe(3);
  });

  it('pairs a reply with the command whose server flag it echoes', async () => {
    const { session, results } = connected();
    session.receive(login());
    await session.settled();
    const first = session.deliver(command({ commandId: 'first' }));
    const second = session.deliver(command({ commandId: 'second' }));
    session.receive(reply(second.correlation, 'Cut off the fuel supply: Success!'));
    session.receive(reply(first.correlation, 'Restore fuel supply: Success!'));
    await session.settled();
    expect(
      results.delivered.mock.calls.map((call): [string, string] => [
        (call[1] as PendingCommand).commandId,
        call[2] as string,
      ]),
    ).toEqual([
      ['second', 'Cut off the fuel supply: Success!'],
      ['first', 'Restore fuel supply: Success!'],
    ]);
  });
});

describe('command dispatch', () => {
  it('claims, then sends, commands for connected devices only', async () => {
    const { session, registry, writes } = connected();
    session.receive(login());
    await session.settled();
    const waiting = queue([command(), command({ commandId: 'elsewhere', deviceId: 'other' })]);
    const sent = await new CommandDispatcher(
      waiting,
      registry,
      () => 1_760_000_001_000,
    ).dispatchOnce();
    expect(sent).toBe(1);
    expect(waiting.markSent).toHaveBeenCalledTimes(1);
    expect(writes.at(-1)?.subarray(9, 17).toString()).toBe('Relay,1#');
    expect(waiting.recordEvent).not.toHaveBeenCalled();
  });

  it('does not send a command another task already claimed', async () => {
    const { session, registry, writes } = connected();
    session.receive(login());
    await session.settled();
    const before = writes.length;
    const waiting = queue([command()]);
    waiting.markSent.mockResolvedValue(false);
    expect(await new CommandDispatcher(waiting, registry).dispatchOnce()).toBe(0);
    expect(writes).toHaveLength(before);
  });

  it('fails commands the protocol cannot encode instead of leaving them waiting', async () => {
    const { session, registry } = connected();
    session.receive(login());
    await session.settled();
    const waiting = queue([command({ type: 'custom', payload: {} })]);
    await new CommandDispatcher(waiting, registry).dispatchOnce();
    expect(waiting.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({ commandId: 'c1' }),
      expect.any(Number),
      expect.stringContaining('cannot send'),
    );
  });

  it('records a queued-command event when the vehicle was away when it was created', async () => {
    const { session, registry } = connected();
    session.receive(login());
    await session.settled();
    const waiting = queue([command({ createdAt: 1_760_000_000_000 })]);
    await new CommandDispatcher(waiting, registry, () => 1_760_000_600_000).dispatchOnce();
    expect(waiting.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'queuedCommandSent',
        attributes: { commandId: 'c1', commandType: 'engineStop' },
      }),
    );
  });

  it('skips the table entirely while no device is connected', async () => {
    const waiting = queue([command()]);
    await new CommandDispatcher(waiting, new Map()).dispatchOnce();
    expect(waiting.pending).not.toHaveBeenCalled();
  });
});

describe('command results', () => {
  it('marks the command delivered and records a commandResult event', async () => {
    const waiting = queue([]);
    await commandResults(waiting, () => 5).delivered(device, command(), 'OK');
    expect(waiting.markDelivered).toHaveBeenCalledWith(
      expect.objectContaining({ commandId: 'c1' }),
      5,
      'OK',
    );
    expect(waiting.recordEvent).toHaveBeenCalledWith({
      tenantId: device.tenantId,
      deviceId: device.deviceId,
      type: 'commandResult',
      eventTime: 5,
      attributes: { result: 'OK', commandId: 'c1', commandType: 'engineStop' },
    });
  });
});

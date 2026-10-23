import { describe, expect, it } from 'vitest';
import { TopinDecoder, type ProtocolPacket } from '../src/index';

// Frames come from the legacy server's Topin decoder tests.
const NOW = Date.UTC(2026, 9, 12, 4, 30, 0);
const hex = (value: string) => Buffer.from(value, 'hex');
const positions = (packets: ProtocolPacket[]) =>
  packets.flatMap((packet) => (packet.kind === 'positions' ? packet.positions : []));

describe('Topin', () => {
  it('reads the IMEI from the login and answers with success and the time', () => {
    const [login] = new TopinDecoder(() => NOW).push(hex('78780d0103593390754169634d0d0a'));
    expect(login).toMatchObject({ kind: 'identity', uniqueId: '359339075416963' });
    expect(login?.acknowledgement?.toString('hex')).toBe(
      '78780d01010d0a' + '78780730' + '07ea0a0c041e00' + '0d0a',
    );
  });

  it('decodes GT06-style fixes and answers with their time', () => {
    const packets = new TopinDecoder().push(
      hex('78781510120B05030D2498038077200BE2078F0034000102030D0A'),
    );
    const [position] = positions(packets);
    expect(position).toMatchObject({ fixTime: Date.UTC(2018, 10, 5, 3, 13, 36), valid: true });
    expect(position?.latitude).toBeCloseTo(0x03807720 / 1_800_000, 6);
    expect(position?.longitude).toBeCloseTo(0x0be2078f / 1_800_000, 6);
    expect(position).toMatchObject({ altitudeM: 0x0102, alarms: ['vibration'], speedKmh: 0 });
    expect(packets.at(-1)?.acknowledgement?.toString('hex')).toBe(
      '7878151012' + '0b05030d24' + '0d0a',
    );
  });

  it('decodes the second GPS format with signed coordinates', () => {
    const [position] = positions(
      new TopinDecoder().push(
        hex('7878200813081A0733211608C8D1710DED1D1608DFFB710E06D51039050100286489000D0A'),
      ),
    );
    expect(position).toMatchObject({ fixTime: Date.UTC(2019, 7, 26, 7, 51, 33), valid: true });
    expect(position?.latitude).toBeCloseTo(22 + 0x08c8d1 / 1e6, 5);
  });

  it('reports SOS and vibration messages as alarms', () => {
    expect(new TopinDecoder().push(hex('787801990D0A'))[0]).toMatchObject({
      kind: 'status',
      status: { alarms: ['sos'] },
    });
    expect(new TopinDecoder().push(hex('787801940D0A'))[0]).toMatchObject({
      kind: 'status',
      status: { alarms: ['vibration'] },
    });
  });

  it('reads battery from status and echoes it back', () => {
    const [status] = new TopinDecoder().push(hex('78780A13424008196400041F000D0A'));
    expect(status).toMatchObject({
      kind: 'status',
      status: { attributes: { batteryLevel: 0x42 } },
    });
    expect(status?.acknowledgement?.toString('hex')).toBe('78780a13424008196400041f000d0a');
  });
});

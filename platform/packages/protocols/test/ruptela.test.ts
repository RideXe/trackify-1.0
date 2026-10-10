import { describe, expect, it } from 'vitest';
import { crc16Kermit, RuptelaDecoder, type ProtocolPacket } from '../src/index';

// Frames come from the legacy server's Ruptela decoder tests; the reply bytes from its decoder.
const positions = (packets: ProtocolPacket[]) =>
  packets.flatMap((packet) => (packet.kind === 'positions' ? packet.positions : []));
const hex = (value: string) => Buffer.from(value, 'hex');

describe('Ruptela', () => {
  it('decodes a record and acknowledges it with the legacy reply', () => {
    const packets = new RuptelaDecoder().push(
      hex(
        '0050000310f5615f419c0100015613d8ed0000fff5b37a035af37801e700000900000d07071b0c020003001c01202cad000500064302a81d33e61e100116317cd3ffff174ad60241000077fa960000f232003c2e',
      ),
    );
    expect(packets[0]).toMatchObject({
      kind: 'identity',
      uniqueId: BigInt('0x000310f5615f419c').toString().padStart(15, '0'),
    });
    const [position] = positions(packets);
    expect(position).toMatchObject({
      fixTime: 0x5613d8ed * 1000,
      valid: true,
      altitudeM: 48.7,
      speedKmh: 0,
    });
    expect(position?.latitude).toBeCloseTo(0x035af378 / 1e7, 6);
    expect(position?.longitude).toBeCloseTo((0xfff5b37a | 0) / 1e7, 6);
    expect(packets.at(-1)?.acknowledgement?.toString('hex')).toBe('0002640113bc');
  });

  it('reads IO values: power and battery in millivolts, ignition', () => {
    const [position] = positions(
      new RuptelaDecoder().push(
        hex(
          '0050000310f5615f419c0100015613d8ed0000fff5b37a035af37801e700000900000d07071b0c020003001c01202cad000500064302a81d33e61e100116317cd3ffff174ad60241000077fa960000f232003c2e',
        ),
      ),
    );
    expect(position?.attributes).toMatchObject({ powerV: 13.286, batteryV: 4.097 });
  });

  it('decodes several records in one frame', () => {
    const fixes = positions(
      new RuptelaDecoder().push(
        hex(
          '00a10003116e7438a7a5010002553dddbe000020fddaff0f12289b007200000600000c070805011b18cf00020003001c01201dad01041d32d81e0d7d160000c50000047200000000d000000000410000b1ae960000a5a300553dddd4000020fdd96f0f122bfe005c16f80700050b090805011b18cf00020003001c01201ead01041d338a1e0d8d160000c50000047200000000d000000000410000b1bd960000a5a3001681',
        ),
      ),
    );
    expect(fixes.map((fix) => fix.fixTime)).toEqual([0x553dddbe * 1000, 0x553dddd4 * 1000]);
  });

  it('frames by the length field across split reads', () => {
    const decoder = new RuptelaDecoder();
    const frame = hex(
      '0050000310f5615f419c0100015613d8ed0000fff5b37a035af37801e700000900000d07071b0c020003001c01202cad000500064302a81d33e61e100116317cd3ffff174ad60241000077fa960000f232003c2e',
    );
    expect(decoder.push(frame.subarray(0, 20))).toEqual([]);
    expect(positions(decoder.push(frame.subarray(20)))).toHaveLength(1);
  });

  it('computes CRC-16/KERMIT and encodes immobiliser commands as legacy did', () => {
    expect(crc16Kermit(Buffer.from([0x64, 0x01])).toString(16)).toBe('13bc');
    const stop = new RuptelaDecoder().encodeCommand({ type: 'engineStop', payload: {} })!;
    expect(stop.readUInt16BE(0)).toBe(1 + 'pass immobilizer 10'.length);
    expect(stop[2]).toBe(108);
    expect(stop.subarray(3, -2).toString()).toBe('pass immobilizer 10');
    expect(stop.readUInt16BE(stop.length - 2)).toBe(crc16Kermit(stop.subarray(2, -2)));
  });
});

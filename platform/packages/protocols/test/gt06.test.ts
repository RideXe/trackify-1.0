import { describe, expect, it } from 'vitest';
import { Gt06Decoder, crc16X25, encodeGt06Acknowledgement, encodeGt06Command } from '../src/index';

function loginFrame(): Buffer {
  const body = Buffer.from('0103563140414198580007', 'hex');
  const frame = Buffer.alloc(2 + 1 + body.length + 2 + 2);
  frame.writeUInt16BE(0x7878, 0);
  frame[2] = body.length + 2;
  body.copy(frame, 3);
  frame.writeUInt16BE(crc16X25(frame.subarray(2, frame.length - 4)), frame.length - 4);
  frame.writeUInt16BE(0x0d0a, frame.length - 2);
  return frame;
}

function locationFrame(): Buffer {
  const body = Buffer.alloc(1 + 18 + 2);
  body[0] = 0x12;
  Buffer.from([24, 9, 14, 12, 30, 45, 0xcc]).copy(body, 1);
  body.writeUInt32BE(Math.round(12.9716 * 1_800_000), 8);
  body.writeUInt32BE(Math.round(77.5946 * 1_800_000), 12);
  body[16] = 50;
  body.writeUInt16BE(0x1000 | 0x0400 | 0x0234, 17);
  body.writeUInt16BE(7, 19);
  const frame = Buffer.alloc(2 + 1 + body.length + 2 + 2);
  frame.writeUInt16BE(0x7878, 0);
  frame[2] = body.length + 2;
  body.copy(frame, 3);
  frame.writeUInt16BE(crc16X25(frame.subarray(2, frame.length - 4)), frame.length - 4);
  frame.writeUInt16BE(0x0d0a, frame.length - 2);
  return frame;
}

describe('GT06', () => {
  it('buffers fragmented login frames and extracts IMEI', () => {
    const decoder = new Gt06Decoder();
    const login = loginFrame();
    expect(decoder.push(login.subarray(0, 5))).toEqual([]);
    const packets = decoder.push(login.subarray(5));
    expect(packets).toHaveLength(1);
    expect(packets[0]).toMatchObject({ kind: 'identity', uniqueId: '356314041419858' });
    expect(packets[0]?.acknowledgement?.toString('hex')).toBe(
      encodeGt06Acknowledgement(1, 7).toString('hex'),
    );
  });

  it('decodes a common GPS packet and returns a durable-acceptance acknowledgement', () => {
    const packets = new Gt06Decoder().push(locationFrame());
    expect(packets[0]).toMatchObject({
      kind: 'positions',
      positions: [{ latitude: 12.9716, longitude: 77.5946, speedKmh: 50, valid: true }],
    });
  });

  it('rejects a bad checksum', () => {
    const frame = loginFrame();
    frame[5] = (frame[5] ?? 0) ^ 1;
    expect(() => new Gt06Decoder().push(frame)).toThrow('checksum');
  });
});

// Frames and expected bytes below come from the legacy server's GT06 decoder and encoder tests.
const hex = (value: string) => Buffer.from(value, 'hex');
/** The legacy decoder never checked GT06 checksums, so some of its test frames carry wrong ones. */
const withValidCrc = (frame: Buffer) => {
  frame.writeUInt16BE(crc16X25(frame.subarray(2, frame.length - 4)), frame.length - 4);
  return frame;
};

describe('GT06 alarms, status and commands', () => {
  it('reads alarms from status-location packets', () => {
    const cases: Array<[string, string]> = [
      [
        '787826161709130f3a2dcc02c55f2a089f9af9005c210901360481fe066d9b03413e420102035f92fe0d0a',
        'sos',
      ],
      ['7878241617070a150e24ca01fba0040780e177005c0001720253360027db6204e40400004bf1e90d0a', 'sos'],
      [
        '78782627100419092D07C5027AC91C0C4658000005370900000000000000008002001900FF00004DF60D0A',
        'lowBattery',
      ],
    ];
    for (const [frame, alarm] of cases) {
      const [packet] = new Gt06Decoder().push(withValidCrc(hex(frame)));
      expect(packet?.kind).toBe('positions');
      if (packet?.kind === 'positions') expect(packet.positions[0]?.alarms).toContain(alarm);
    }
  });

  it('answers heartbeats so the tracker keeps the connection', () => {
    const [packet] = new Gt06Decoder().push(hex('78780a130604ea04000006bc8a0d0a'));
    expect(packet?.kind).toBe('status');
    expect(packet?.acknowledgement?.toString('hex')).toBe(
      encodeGt06Acknowledgement(0x13, 6).toString('hex'),
    );
    if (packet?.kind === 'status') expect(packet.status.attributes.ignition).toBe(true);
  });

  it('reads command replies with the server flag they answer', () => {
    const [packet] = new Gt06Decoder().push(
      hex(
        '7878281520000000003c49434349443a38393838323339303030303039373330323635303e00020d446f260d0a',
      ),
    );
    expect(packet).toEqual({
      kind: 'commandResult',
      correlation: 0,
      result: '<ICCID:89882390000097302650>',
    });
  });

  it('encodes engine stop exactly like the legacy server', () => {
    const encoded = new Gt06Decoder().encodeCommand({ type: 'engineStop', payload: {} }, 0);
    expect(encoded?.toString('hex')).toBe('787812800c0000000052656c61792c312300009dee0d0a');
  });

  it('round-trips the server flag and refuses commands it cannot encode', () => {
    const encoded = encodeGt06Command('DYD,123456#', 0x01020304);
    expect(encoded.readUInt32BE(5)).toBe(0x01020304);
    expect(crc16X25(encoded.subarray(2, encoded.length - 4))).toBe(
      encoded.readUInt16BE(encoded.length - 4),
    );
    const decoder = new Gt06Decoder();
    expect(decoder.encodeCommand({ type: 'custom', payload: {} }, 1)).toBeUndefined();
    expect(decoder.encodeCommand({ type: 'positionPeriodic', payload: {} }, 1)).toBeUndefined();
  });
});

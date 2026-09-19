import { describe, expect, it } from 'vitest';
import { Gt06Decoder, crc16X25, encodeGt06Acknowledgement } from '../src/index';

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
    expect(packets[0]?.acknowledgement.toString('hex')).toBe(
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

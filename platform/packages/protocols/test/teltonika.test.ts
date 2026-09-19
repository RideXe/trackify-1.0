import { describe, expect, it } from 'vitest';
import { TeltonikaDecoder, crc16Ibm } from '../src/index';

function avlFrame(): Buffer {
  const record = Buffer.alloc(8 + 1 + 4 + 4 + 2 + 2 + 1 + 2 + 2 + 2 + 3 + 2 + 2 + 2 + 2);
  let offset = 0;
  record.writeBigUInt64BE(BigInt(1_757_836_800_000), offset);
  offset += 8;
  record[offset++] = 1;
  record.writeInt32BE(Math.round(77.5946 * 10_000_000), offset);
  offset += 4;
  record.writeInt32BE(Math.round(12.9716 * 10_000_000), offset);
  offset += 4;
  record.writeInt16BE(920, offset);
  offset += 2;
  record.writeUInt16BE(180, offset);
  offset += 2;
  record[offset++] = 12;
  record.writeUInt16BE(60, offset);
  offset += 2;
  record[offset++] = 239; // event IO
  record[offset++] = 1; // total IO
  record[offset++] = 1; // one 1-byte IO
  record[offset++] = 239;
  record[offset++] = 1;
  record[offset++] = 0; // 2-byte count
  record[offset++] = 0; // 4-byte count
  record[offset++] = 0; // 8-byte count
  const data = Buffer.concat([
    Buffer.from([0x08, 1]),
    record.subarray(0, offset),
    Buffer.from([1]),
  ]);
  const frame = Buffer.alloc(data.length + 12);
  frame.writeUInt32BE(0, 0);
  frame.writeUInt32BE(data.length, 4);
  data.copy(frame, 8);
  frame.writeUInt32BE(crc16Ibm(data), 8 + data.length);
  return frame;
}

describe('Teltonika', () => {
  it('accepts a fragmented IMEI packet', () => {
    const login = Buffer.from('000f313233343536373839303132333435', 'hex');
    const decoder = new TeltonikaDecoder();
    expect(decoder.push(login.subarray(0, 4))).toEqual([]);
    expect(decoder.push(login.subarray(4))[0]).toMatchObject({
      kind: 'identity',
      uniqueId: '123456789012345',
      acknowledgement: Buffer.from([1]),
    });
  });

  it('decodes Codec 8 location and IO values', () => {
    const packet = new TeltonikaDecoder().push(avlFrame())[0];
    expect(packet).toMatchObject({
      kind: 'positions',
      acknowledgement: Buffer.from([0, 0, 0, 1]),
      positions: [
        {
          latitude: 12.9716,
          longitude: 77.5946,
          speedKmh: 60,
          attributes: { ignition: true, satellites: 12 },
        },
      ],
    });
  });

  it('rejects a corrupt AVL packet', () => {
    const frame = avlFrame();
    frame[10] = (frame[10] ?? 0) ^ 1;
    expect(() => new TeltonikaDecoder().push(frame)).toThrow('checksum');
  });
});

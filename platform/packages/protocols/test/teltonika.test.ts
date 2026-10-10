import { describe, expect, it } from 'vitest';
import { TeltonikaDecoder, crc16Ibm, encodeTeltonikaCommand } from '../src/index';

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

describe('Teltonika codec 12 commands', () => {
  // Expected bytes from the legacy server's Teltonika encoder tests.
  it('encodes text and hex commands exactly like the legacy server', () => {
    const decoder = new TeltonikaDecoder();
    expect(
      decoder.encodeCommand({ type: 'custom', payload: { data: 'setdigout 11' } })?.toString('hex'),
    ).toBe('00000000000000140c01050000000c7365746469676f7574203131010000bed5');
    expect(
      decoder
        .encodeCommand({ type: 'custom', payload: { data: '03030000000185E8' } })
        ?.toString('hex'),
    ).toBe('00000000000000100c01050000000803030000000185e8010000da8b');
    expect(
      decoder.encodeCommand({ type: 'engineStop', payload: {} })?.subarray(15, 26).toString(),
    ).toBe('setdigout 1');
  });

  it('reads a command response instead of dropping the connection', () => {
    const reply = Buffer.from('DOUT1:1 Timeout:INFINITY', 'ascii');
    const frame = encodeTeltonikaCommand(reply);
    frame[10] = 0x06; // response type
    frame.writeUInt32BE(crc16Ibm(frame.subarray(8, frame.length - 4)), frame.length - 4);
    expect(new TeltonikaDecoder().push(frame)).toEqual([
      { kind: 'commandResult', result: 'DOUT1:1 Timeout:INFINITY' },
    ]);
  });
});

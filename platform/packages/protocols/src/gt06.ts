import {
  concatPending,
  stableMessageId,
  type ProtocolDecoder,
  type ProtocolPacket,
} from './common';
import { crc16X25 } from './crc';

const STANDARD_HEADER = 0x7878;
const EXTENDED_HEADER = 0x7979;
const TAIL = 0x0d0a;

export class Gt06Decoder implements ProtocolDecoder {
  readonly protocol = 'gt06' as const;
  private pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  push(chunk: Buffer): ProtocolPacket[] {
    this.pending = concatPending(this.pending, chunk);
    const packets: ProtocolPacket[] = [];
    while (true) {
      const frame = this.takeFrame();
      if (!frame) break;
      packets.push(...decodeGt06Frame(frame));
    }
    return packets;
  }

  private takeFrame(): Buffer | undefined {
    while (this.pending.length >= 2) {
      const header = this.pending.readUInt16BE(0);
      if (header === STANDARD_HEADER || header === EXTENDED_HEADER) break;
      this.pending = this.pending.subarray(1);
    }
    if (this.pending.length < 5) return undefined;
    const extended = this.pending.readUInt16BE(0) === EXTENDED_HEADER;
    const bodyLength = extended ? this.pending.readUInt16BE(2) : this.pending[2];
    if (bodyLength === undefined) return undefined;
    const frameLength = (extended ? 6 : 5) + bodyLength;
    if (frameLength > 65_535) throw new Error('GT06 frame is too large');
    if (this.pending.length < frameLength) return undefined;
    const frame = this.pending.subarray(0, frameLength);
    this.pending = this.pending.subarray(frameLength);
    if (frame.readUInt16BE(frame.length - 2) !== TAIL) throw new Error('invalid GT06 frame tail');
    const crcOffset = frame.length - 4;
    const crcStart = extended ? 2 : 2;
    const expected = frame.readUInt16BE(crcOffset);
    const actual = crc16X25(frame.subarray(crcStart, crcOffset));
    if (actual !== expected) throw new Error('invalid GT06 checksum');
    return frame;
  }
}

export function decodeGt06Frame(frame: Buffer): ProtocolPacket[] {
  const extended = frame.readUInt16BE(0) === EXTENDED_HEADER;
  const protocolOffset = extended ? 4 : 3;
  const type = frame[protocolOffset];
  if (type === undefined) return [];
  const serialOffset = frame.length - 6;
  const serial = frame.readUInt16BE(serialOffset);
  const acknowledgement = encodeGt06Acknowledgement(type, serial, extended);

  if (type === 0x01) {
    const imeiBytes = frame.subarray(protocolOffset + 1, protocolOffset + 9);
    const digits = imeiBytes.toString('hex');
    const uniqueId = digits.length === 16 && digits.startsWith('0') ? digits.slice(1) : digits;
    return [{ kind: 'identity', uniqueId, acknowledgement }];
  }

  if (![0x10, 0x11, 0x12, 0x16, 0x22, 0x26, 0x27, 0x2d, 0x37].includes(type)) return [];
  const offset = protocolOffset + 1;
  if (serialOffset - offset < 18) return [];
  const year = 2000 + (frame[offset] ?? 0);
  const month = frame[offset + 1] ?? 1;
  const day = frame[offset + 2] ?? 1;
  const hour = frame[offset + 3] ?? 0;
  const minute = frame[offset + 4] ?? 0;
  const second = frame[offset + 5] ?? 0;
  const gpsInfo = frame[offset + 6] ?? 0;
  let latitude = frame.readUInt32BE(offset + 7) / 1_800_000;
  let longitude = frame.readUInt32BE(offset + 11) / 1_800_000;
  const speedKmh = frame[offset + 15] ?? 0;
  const courseStatus = frame.readUInt16BE(offset + 16);
  if ((courseStatus & 0x0400) === 0) latitude = -latitude;
  if ((courseStatus & 0x0800) !== 0) longitude = -longitude;
  const fixTime = Date.UTC(year, month - 1, day, hour, minute, second);
  if (!Number.isFinite(fixTime)) return [];

  return [
    {
      kind: 'positions',
      acknowledgement,
      positions: [
        {
          messageId: stableMessageId('gt06', frame),
          fixTime,
          valid: (courseStatus & 0x1000) !== 0,
          latitude,
          longitude,
          speedKmh,
          courseDeg: courseStatus & 0x03ff,
          attributes: { satellites: gpsInfo & 0x0f, protocolType: type },
        },
      ],
    },
  ];
}

export function encodeGt06Acknowledgement(type: number, serial: number, extended = false): Buffer {
  const response = Buffer.alloc(extended ? 11 : 10);
  response.writeUInt16BE(extended ? EXTENDED_HEADER : STANDARD_HEADER, 0);
  if (extended) response.writeUInt16BE(5, 2);
  else response[2] = 5;
  const typeOffset = extended ? 4 : 3;
  response[typeOffset] = type;
  response.writeUInt16BE(serial, typeOffset + 1);
  response.writeUInt16BE(crc16X25(response.subarray(2, typeOffset + 3)), typeOffset + 3);
  response.writeUInt16BE(TAIL, typeOffset + 5);
  return response;
}

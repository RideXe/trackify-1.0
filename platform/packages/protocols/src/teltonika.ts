import {
  concatPending,
  stableMessageId,
  type DecodedPosition,
  type ProtocolDecoder,
  type ProtocolPacket,
} from './common';
import { crc16Ibm } from './crc';

export class TeltonikaDecoder implements ProtocolDecoder {
  readonly protocol = 'teltonika' as const;
  private pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  push(chunk: Buffer): ProtocolPacket[] {
    this.pending = concatPending(this.pending, chunk);
    const packets: ProtocolPacket[] = [];
    while (true) {
      const frame = this.takeFrame();
      if (!frame) break;
      packets.push(decodeTeltonikaFrame(frame));
    }
    return packets;
  }

  private takeFrame(): Buffer | undefined {
    if (this.pending.length < 2) return undefined;
    if (this.pending[0] === 0xff) {
      const frame = this.pending.subarray(0, 1);
      this.pending = this.pending.subarray(1);
      return frame;
    }
    const identificationLength = this.pending.readUInt16BE(0);
    if (identificationLength > 0) {
      if (identificationLength > 64) throw new Error('invalid Teltonika identification length');
      if (this.pending.length < identificationLength + 2) return undefined;
      const frame = this.pending.subarray(0, identificationLength + 2);
      this.pending = this.pending.subarray(identificationLength + 2);
      return frame;
    }
    if (this.pending.length < 12) return undefined;
    const dataLength = this.pending.readUInt32BE(4);
    if (dataLength > 1024 * 1024) throw new Error('Teltonika frame is too large');
    const frameLength = dataLength + 12;
    if (this.pending.length < frameLength) return undefined;
    const frame = this.pending.subarray(0, frameLength);
    this.pending = this.pending.subarray(frameLength);
    return frame;
  }
}

export function decodeTeltonikaFrame(frame: Buffer): ProtocolPacket {
  if (frame.length === 1 && frame[0] === 0xff) {
    return { kind: 'identity', uniqueId: '', acknowledgement: Buffer.from([0]) };
  }
  const identificationLength = frame.readUInt16BE(0);
  if (identificationLength > 0) {
    const uniqueId = frame.subarray(2, 2 + identificationLength).toString('ascii');
    if (!/^\d{14,16}$/.test(uniqueId)) throw new Error('invalid Teltonika IMEI');
    return { kind: 'identity', uniqueId, acknowledgement: Buffer.from([1]) };
  }
  const dataLength = frame.readUInt32BE(4);
  const data = frame.subarray(8, 8 + dataLength);
  const expectedCrc = frame.readUInt32BE(8 + dataLength) & 0xffff;
  if (crc16Ibm(data) !== expectedCrc) throw new Error('invalid Teltonika checksum');
  const codec = data[0];
  if (codec !== 0x08 && codec !== 0x8e) throw new Error(`unsupported Teltonika codec ${codec}`);
  const count = data[1] ?? 0;
  let offset = 2;
  const positions: DecodedPosition[] = [];
  for (let record = 0; record < count; record += 1) {
    const decoded = decodeAvlRecord(
      data,
      offset,
      codec,
      stableMessageId('teltonika', frame, record),
    );
    positions.push(decoded.position);
    offset = decoded.offset;
  }
  if (data[offset] !== count) throw new Error('Teltonika record count mismatch');
  const acknowledgement = Buffer.alloc(4);
  acknowledgement.writeUInt32BE(count);
  return { kind: 'positions', positions, acknowledgement };
}

function decodeAvlRecord(data: Buffer, start: number, codec: number, messageId: string) {
  let offset = start;
  ensure(data, offset, 24);
  const fixTime = Number(data.readBigUInt64BE(offset));
  offset += 8;
  const priority = data[offset] ?? 0;
  offset += 1;
  const longitude = data.readInt32BE(offset) / 10_000_000;
  offset += 4;
  const latitude = data.readInt32BE(offset) / 10_000_000;
  offset += 4;
  const altitudeM = data.readInt16BE(offset);
  offset += 2;
  const courseDeg = data.readUInt16BE(offset);
  offset += 2;
  const satellites = data[offset] ?? 0;
  offset += 1;
  const speedKmh = data.readUInt16BE(offset);
  offset += 2;
  const extended = codec === 0x8e;
  const readId = () => {
    const value = extended ? data.readUInt16BE(offset) : (data[offset] ?? 0);
    offset += extended ? 2 : 1;
    return value;
  };
  const readCount = readId;
  const eventIo = readId();
  readCount(); // total IO count; bucket counts below are authoritative for framing
  const io: Record<string, number | string | boolean> = {};
  for (const width of [1, 2, 4, 8]) {
    const count = readCount();
    for (let item = 0; item < count; item += 1) {
      const id = readId();
      ensure(data, offset, width);
      const value =
        width === 8 ? data.readBigUInt64BE(offset).toString() : readUnsigned(data, offset, width);
      offset += width;
      io[String(id)] = value;
    }
  }
  if (extended) {
    const variableCount = readCount();
    for (let item = 0; item < variableCount; item += 1) {
      const id = readId();
      ensure(data, offset, 2);
      const length = data.readUInt16BE(offset);
      offset += 2;
      ensure(data, offset, length);
      io[String(id)] = data.subarray(offset, offset + length).toString('hex');
      offset += length;
    }
  }
  const ignition = io['239'] === 1;
  const motion = io['240'] === 1;
  return {
    offset,
    position: {
      messageId,
      fixTime,
      valid:
        satellites > 0 &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180,
      latitude,
      longitude,
      altitudeM,
      speedKmh,
      courseDeg,
      attributes: { satellites, priority, eventIo, ignition, motion, ...prefixIo(io) },
    } satisfies DecodedPosition,
  };
}

function readUnsigned(data: Buffer, offset: number, width: number): number {
  if (width === 1) return data.readUInt8(offset);
  if (width === 2) return data.readUInt16BE(offset);
  return data.readUInt32BE(offset);
}

function prefixIo(io: Record<string, number | string | boolean>) {
  return Object.fromEntries(Object.entries(io).map(([key, value]) => [`io.${key}`, value]));
}

function ensure(data: Buffer, offset: number, width: number) {
  if (offset + width > data.length) throw new Error('truncated Teltonika AVL record');
}

import {
  concatPending,
  customCommandData,
  stableMessageId,
  type DecodedPosition,
  type ProtocolCommand,
  type ProtocolDecoder,
  type ProtocolPacket,
} from './common';
import { crc16Kermit } from './crc';

const MSG_RECORDS = 1;
const MSG_SMS_VIA_GPRS = 8;
const MSG_EXTENDED_RECORDS = 68;
/** Records are acknowledged with this fixed reply, as the legacy decoder sent it. */
const RECORDS_ACK = Buffer.from('0002640113bc', 'hex');
const EMPTY = Buffer.alloc(0);
const NO_COORDINATE = -0x80000000;

/** IO ids with a known meaning (the legacy decoder's mapping); others are kept as io.<id>. */
const IO: Record<number, (value: number, position: DecodedPosition) => void> = {
  2: (value, position) => (position.attributes.in1 = value > 0),
  3: (value, position) => (position.attributes.in2 = value > 0),
  4: (value, position) => (position.attributes.in3 = value > 0),
  5: (value, position) => (position.attributes.in4 = value > 0),
  13: (value, position) => (position.attributes.motion = value > 0),
  173: (value, position) => (position.attributes.motion = value > 0),
  29: (value, position) => (position.attributes.powerV = value / 1000),
  30: (value, position) => (position.attributes.batteryV = value / 1000),
  65: (value, position) => (position.attributes.odometer = value),
  98: (value, position) => (position.attributes.fuelLevel = Math.round((value * 100) / 255)),
  170: (value, position) => (position.attributes.charge = value > 0),
  251: (value, position) => (position.attributes.ignition = value > 0),
  409: (value, position) => (position.attributes.ignition = value > 0),
};
/** IO ids that raise an alarm when non-zero (or, for 415, when zero). */
const IO_ALARMS: Record<number, [string, (value: number) => boolean]> = {
  88: ['jamming', (value) => value > 0],
  134: ['hardBraking', (value) => value > 0],
  136: ['hardAcceleration', (value) => value > 0],
  410: ['tow', (value) => value > 0],
  411: ['accident', (value) => value > 0],
  415: ['gpsAntennaCut', (value) => value === 0],
};

/**
 * Ruptela binary protocol (FM-Eco, FM-Pro, FM-Tco and others): length, IMEI, command, data and a
 * CRC-16/KERMIT. Ported from the legacy server's Ruptela decoder and encoder (records and
 * extended records; files, DTCs and tachograph data are not decoded).
 */
export class RuptelaDecoder implements ProtocolDecoder {
  readonly protocol = 'ruptela' as const;
  private pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private uniqueId?: string;

  push(chunk: Buffer): ProtocolPacket[] {
    this.pending = concatPending(this.pending, chunk);
    const packets: ProtocolPacket[] = [];
    while (this.pending.length >= 2) {
      const length = this.pending.readUInt16BE(0);
      if (this.pending.length < length + 4) break;
      const frame = this.pending.subarray(0, length + 4);
      this.pending = this.pending.subarray(length + 4);
      packets.push(...this.frame(frame));
    }
    return packets;
  }

  /** Immobiliser commands go as SMS text over GPRS, with the default "pass" password. */
  encodeCommand(command: ProtocolCommand): Buffer | undefined {
    if (command.type === 'engineStop')
      return encodeContent(MSG_SMS_VIA_GPRS, Buffer.from('pass immobilizer 10'));
    if (command.type === 'engineResume')
      return encodeContent(MSG_SMS_VIA_GPRS, Buffer.from('pass resetimmob'));
    const data = customCommandData(command);
    if (command.type !== 'custom' || !data) return undefined;
    return /^([0-9a-fA-F]{2})+$/.test(data)
      ? Buffer.from(data, 'hex')
      : encodeContent(MSG_SMS_VIA_GPRS, Buffer.from(data, 'ascii'));
  }

  private frame(frame: Buffer): ProtocolPacket[] {
    const packets: ProtocolPacket[] = [];
    if (frame.length < 13) return packets;
    const imei = frame.readBigUInt64BE(2).toString().padStart(15, '0');
    if (imei !== this.uniqueId) {
      this.uniqueId = imei;
      packets.push({ kind: 'identity', uniqueId: imei, acknowledgement: EMPTY });
    }
    const type = frame[10];
    if (type === MSG_RECORDS || type === MSG_EXTENDED_RECORDS) {
      const positions = decodeRecords(frame, type === MSG_EXTENDED_RECORDS);
      packets.push({ kind: 'positions', positions, acknowledgement: RECORDS_ACK });
    } else if (type === MSG_SMS_VIA_GPRS - 1) {
      // 7: the reply to a command sent as SMS over GPRS.
      packets.push({
        kind: 'commandResult',
        result: frame.subarray(11, frame.length - 2).toString('ascii'),
      });
    }
    return packets;
  }
}

function decodeRecords(frame: Buffer, extended: boolean): DecodedPosition[] {
  let offset = 12; // after length, IMEI, command and records-left
  const count = frame[offset++] ?? 0;
  const positions: DecodedPosition[] = [];
  const end = frame.length - 2;
  const readId = () => {
    const id = extended ? frame.readUInt16BE(offset) : frame[offset]!;
    offset += extended ? 2 : 1;
    return id;
  };
  for (let record = 0; record < count && offset + 23 <= end; record += 1) {
    const fixTime = frame.readUInt32BE(offset) * 1000;
    offset += 5; // time and its extension
    if (extended) offset += 1; // record extension (merged records are kept separate)
    offset += 1; // priority
    const longitude = frame.readInt32BE(offset);
    const latitude = frame.readInt32BE(offset + 4);
    const altitudeM = frame.readUInt16BE(offset + 8) / 10;
    const courseDeg = frame.readUInt16BE(offset + 10) / 100;
    const satellites = frame[offset + 12]!;
    const speedKmh = frame.readUInt16BE(offset + 13);
    const hdop = frame[offset + 15]! / 10;
    offset += 16;
    const event = extended ? frame.readUInt16BE(offset) : frame[offset]!;
    offset += extended ? 2 : 1;
    const valid = longitude !== NO_COORDINATE && latitude !== NO_COORDINATE;
    const position: DecodedPosition = {
      messageId: stableMessageId('ruptela', frame, record),
      fixTime,
      valid,
      latitude: valid ? latitude / 1e7 : 0,
      longitude: valid ? longitude / 1e7 : 0,
      altitudeM,
      courseDeg,
      speedKmh,
      attributes: { satellites, hdop, event },
    };
    const alarms: string[] = [];
    for (const width of [1, 2, 4, 8]) {
      const values = frame[offset++] ?? 0;
      for (let item = 0; item < values; item += 1) {
        const id = readId();
        const value =
          width === 1
            ? frame[offset]!
            : width === 2
              ? frame.readUInt16BE(offset)
              : width === 4
                ? frame.readUInt32BE(offset)
                : Number(frame.readBigUInt64BE(offset));
        if (id === 34)
          position.attributes.driverUniqueId = frame
            .subarray(offset, offset + width)
            .toString('hex');
        offset += width;
        const known = IO[id];
        if (known) known(value, position);
        else if (id !== 34) position.attributes[`io${id}`] = value;
        const alarm = IO_ALARMS[id];
        if (alarm?.[1](value)) alarms.push(alarm[0]);
      }
    }
    if (alarms.length) position.alarms = alarms;
    positions.push(position);
  }
  return positions;
}

export function encodeContent(type: number, content: Buffer): Buffer {
  const frame = Buffer.alloc(2 + 1 + content.length + 2);
  frame.writeUInt16BE(1 + content.length, 0);
  frame[2] = 100 + type;
  content.copy(frame, 3);
  frame.writeUInt16BE(crc16Kermit(frame.subarray(2, frame.length - 2)), frame.length - 2);
  return frame;
}

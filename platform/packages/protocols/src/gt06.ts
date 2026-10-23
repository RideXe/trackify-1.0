import {
  concatPending,
  customCommandData,
  stableMessageId,
  type ProtocolCommand,
  type ProtocolDecoder,
  type ProtocolPacket,
} from './common';
import { crc16X25 } from './crc';

const STANDARD_HEADER = 0x7878;
const EXTENDED_HEADER = 0x7979;
const TAIL = 0x0d0a;

const MSG_LOGIN = 0x01;
const MSG_STATUS = 0x13;
const MSG_STRING = 0x15;
const MSG_GPS_LBS_STATUS_1 = 0x16;
const MSG_GPS_LBS_2 = 0x22;
const MSG_HEARTBEAT = 0x23;
const MSG_GPS_LBS_STATUS_2 = 0x26;
const MSG_GPS_LBS_STATUS_3 = 0x27;
const MSG_STRING_INFO = 0x21;
const MSG_COMMAND_0 = 0x80;
const LOCATION_TYPES = [0x10, 0x11, 0x12, 0x16, 0x22, 0x26, 0x27, 0x2d, 0x37];
const STATUS_LOCATION_TYPES = [MSG_GPS_LBS_STATUS_1, MSG_GPS_LBS_STATUS_2, MSG_GPS_LBS_STATUS_3];

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

  /** Engine commands follow the legacy encoder: Concox `Relay,1#`; other models via `custom`. */
  encodeCommand(command: ProtocolCommand, correlation: number): Buffer | undefined {
    if (command.type === 'engineStop') return encodeGt06Command('Relay,1#', correlation);
    if (command.type === 'engineResume') return encodeGt06Command('Relay,0#', correlation);
    const data = customCommandData(command);
    if (command.type === 'custom' && data) return encodeGt06Command(data, correlation);
    return undefined;
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

  if (type === MSG_LOGIN) {
    const imeiBytes = frame.subarray(protocolOffset + 1, protocolOffset + 9);
    const digits = imeiBytes.toString('hex');
    const uniqueId = digits.length === 16 && digits.startsWith('0') ? digits.slice(1) : digits;
    return [{ kind: 'identity', uniqueId, acknowledgement }];
  }

  // Heartbeats must be answered or the tracker treats the link as dead and reconnects.
  if (type === MSG_STATUS) {
    const offset = protocolOffset + 1;
    if (serialOffset - offset < 4)
      return [{ kind: 'status', status: { attributes: {}, alarms: [] }, acknowledgement }];
    const terminal = decodeTerminalInfo(frame[offset] ?? 0);
    const alarm = decodeGt06Alarm(frame[offset + 3] ?? 0);
    const battery = batteryLevel(frame[offset + 1] ?? 0);
    return [
      {
        kind: 'status',
        acknowledgement,
        status: {
          attributes: {
            ...terminal.attributes,
            ...(battery === undefined ? {} : { batteryLevel: battery }),
            rssi: frame[offset + 2] ?? 0,
          },
          alarms: [...new Set([...terminal.alarms, ...(alarm ? [alarm] : [])])],
        },
      },
    ];
  }
  if (type === MSG_HEARTBEAT)
    return [{ kind: 'status', status: { attributes: {}, alarms: [] }, acknowledgement }];

  // Command replies carry back the server flag the command was sent with.
  if (type === MSG_STRING) {
    const length = frame[protocolOffset + 1] ?? 0;
    if (length < 4) return [];
    const start = protocolOffset + 2;
    return [
      {
        kind: 'commandResult',
        correlation: frame.readUInt32BE(start),
        result: frame.subarray(start + 4, Math.min(start + length, serialOffset)).toString('ascii'),
      },
    ];
  }
  if (type === MSG_STRING_INFO) {
    const start = protocolOffset + 1;
    if (serialOffset - start < 5) return [];
    const content = frame.subarray(start + 5, serialOffset);
    return [
      {
        kind: 'commandResult',
        correlation: frame.readUInt32BE(start),
        result: frame[start + 4] === 1 ? content.toString('ascii') : utf16be(content),
      },
    ];
  }

  if (!LOCATION_TYPES.includes(type)) return [];
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
  const extra = decodeLocationExtras(frame, type, offset + 18, serialOffset);

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
          attributes: { satellites: gpsInfo & 0x0f, protocolType: type, ...extra.attributes },
          ...(extra.alarms.length ? { alarms: extra.alarms } : {}),
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

/** 0x80 online command; the 4-byte server flag comes back in the 0x15/0x21 reply. */
export function encodeGt06Command(content: string, serverFlag: number): Buffer {
  const text = Buffer.from(content, 'ascii');
  const bodyLength = 1 + 1 + 4 + text.length + 2 + 2;
  if (bodyLength > 0xff) throw new Error('GT06 command is too long');
  const frame = Buffer.alloc(2 + 1 + bodyLength + 2);
  frame.writeUInt16BE(STANDARD_HEADER, 0);
  frame[2] = bodyLength;
  frame[3] = MSG_COMMAND_0;
  frame[4] = 4 + text.length;
  frame.writeUInt32BE(serverFlag >>> 0, 5);
  text.copy(frame, 9);
  frame.writeUInt16BE(serverFlag & 0xffff, 9 + text.length);
  frame.writeUInt16BE(crc16X25(frame.subarray(2, frame.length - 4)), frame.length - 4);
  frame.writeUInt16BE(TAIL, frame.length - 2);
  return frame;
}

/** Alarm byte of status and alarm packets, as mapped by the legacy decoder (generic models). */
export function decodeGt06Alarm(value: number): string | undefined {
  switch (value) {
    case 0x01:
      return 'sos';
    case 0x02:
      return 'powerCut';
    case 0x03:
    case 0x09:
      return 'vibration';
    case 0x04:
      return 'geofenceEnter';
    case 0x05:
      return 'geofenceExit';
    case 0x06:
      return 'overspeed';
    case 0x0e:
    case 0x0f:
    case 0x19:
      return 'lowBattery';
    case 0x11:
      return 'powerOff';
    case 0x0c:
    case 0x13:
    case 0x25:
      return 'tampering';
    case 0x14:
      return 'door';
    case 0x18:
      return 'removing';
    case 0x1a:
    case 0x27:
    case 0x28:
      return 'hardBraking';
    case 0x1b:
    case 0x2a:
    case 0x2b:
    case 0x2e:
      return 'hardCornering';
    case 0x23:
      return 'fallDown';
    case 0x26:
    case 0x29:
      return 'hardAcceleration';
    case 0x2c:
      return 'accident';
    case 0x30:
      return 'jamming';
    default:
      return undefined;
  }
}

/** Terminal information byte: ignition (ACC), charging, relay (engine cut) state and alarm bits. */
function decodeTerminalInfo(value: number, variant: Variant = 'standard') {
  const alarms: string[] = [];
  const terminalAlarm = (value >> 3) & 0x07;
  if (terminalAlarm === 1) alarms.push('vibration');
  if (terminalAlarm === 2) alarms.push('powerCut');
  if (terminalAlarm === 3) alarms.push('lowBattery');
  if (terminalAlarm === 4) alarms.push('sos');
  if (terminalAlarm === 6) alarms.push('geofence');
  if (terminalAlarm === 7) alarms.push(variant === 'vxt01' ? 'overspeed' : 'removing');
  return {
    attributes: {
      ignition: (value & 0x02) !== 0,
      charge: (value & 0x04) !== 0,
      blocked: (value & 0x80) !== 0,
    },
    alarms,
  };
}

/** Battery as sent: a 0–6 voltage level on most models, a percentage on newer ones. */
function batteryLevel(value: number): number | undefined {
  if (value <= 6) return Math.round((value * 100) / 6);
  return value <= 100 ? value : undefined;
}

/** Layout differences the legacy decoder recognises from packet type and length. */
type Variant = 'standard' | 'vxt01' | 'seeworld';

function variantOf(type: number, bodyLength: number): Variant {
  if (type === MSG_GPS_LBS_STATUS_1 && bodyLength === 0x24) return 'vxt01';
  if (type === MSG_GPS_LBS_STATUS_1 && bodyLength === 0x26) return 'seeworld';
  return 'standard';
}

/** What follows the GPS block: LBS, then status and alarm (0x16/0x26/0x27) or ACC (0x22). */
function decodeLocationExtras(frame: Buffer, type: number, start: number, end: number) {
  const empty = { attributes: {} as Record<string, number | boolean>, alarms: [] as string[] };
  if (STATUS_LOCATION_TYPES.includes(type)) {
    const variant = variantOf(type, frame[2] ?? 0);
    // LBS: [length] MCC(2) MNC(1, or 2 when the MCC's top bit is set) LAC(2) cell id(3, SeeWorld 4).
    let offset = start + (variant === 'vxt01' ? 0 : 1);
    if (offset + 2 > end) return empty;
    const mcc = frame.readUInt16BE(offset);
    offset += 2 + ((mcc & 0x8000) !== 0 ? 2 : 1) + 2 + (variant === 'seeworld' ? 4 : 3);
    if (end - offset < 4) return empty;
    const terminal = decodeTerminalInfo(frame[offset] ?? 0, variant);
    let extension = frame[offset + 3] ?? 0;
    if (type === MSG_GPS_LBS_STATUS_3) extension += ((frame[offset + 4] ?? 0) >> 4) << 8;
    // VXT01 uses the alarm byte for something else.
    const alarm = variant === 'vxt01' ? undefined : decodeGt06Alarm(extension);
    const battery = batteryLevel(frame[offset + 1] ?? 0);
    return {
      attributes: {
        ...terminal.attributes,
        ...(battery === undefined ? {} : { batteryLevel: battery }),
        rssi: frame[offset + 2] ?? 0,
      },
      alarms: [...new Set([...terminal.alarms, ...(alarm ? [alarm] : [])])],
    };
  }
  if (type === MSG_GPS_LBS_2 && end - start >= 9) {
    return { attributes: { ignition: frame[start + 8] === 1 }, alarms: [] };
  }
  return empty;
}

function utf16be(content: Buffer) {
  const swapped = Buffer.from(content);
  if (swapped.length % 2) return '';
  swapped.swap16();
  return swapped.toString('utf16le');
}

import {
  concatPending,
  customCommandData,
  stableMessageId,
  type DecodedPosition,
  type ProtocolCommand,
  type ProtocolDecoder,
  type ProtocolPacket,
} from './common';

const KNOTS_TO_KMH = 1.852;
/** Binary frames are 32 bytes; some models append 13 more. */
const BINARY_SHORT = 32;
const BINARY_LONG = 45;
const EMPTY = Buffer.alloc(0);

/**
 * H02 (Sinotrack and many clones): `*XX,<id>,<type>,...#` text and `$`-prefixed binary frames.
 * Every message carries the device id, so an identity packet is emitted whenever it first appears.
 * Ported from the legacy server's H02 decoder, frame decoder and encoder.
 */
export class H02Decoder implements ProtocolDecoder {
  readonly protocol = 'h02' as const;
  private pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private uniqueId?: string;

  constructor(private readonly now: () => number = Date.now) {}

  push(chunk: Buffer): ProtocolPacket[] {
    this.pending = concatPending(this.pending, chunk);
    const packets: ProtocolPacket[] = [];
    for (let frame = this.takeFrame(); frame; frame = this.takeFrame()) {
      const decoded =
        frame[0] === 0x24 ? this.binary(frame) : this.text(frame.toString('ascii').trim());
      if (!decoded) continue;
      if (decoded.uniqueId && decoded.uniqueId !== this.uniqueId) {
        this.uniqueId = decoded.uniqueId;
        packets.push({ kind: 'identity', uniqueId: decoded.uniqueId, acknowledgement: EMPTY });
      }
      packets.push(...decoded.packets);
    }
    return packets;
  }

  /** `S20` cuts (1) or restores (0) the fuel relay, as the legacy encoder sent it. */
  encodeCommand(command: ProtocolCommand): Buffer | undefined {
    if (!this.uniqueId) return undefined;
    const time = new Date(this.now()).toISOString().slice(11, 19).replace(/:/g, '');
    if (command.type === 'engineStop') return Buffer.from(`*HQ,${this.uniqueId},S20,${time},1,1#`);
    if (command.type === 'engineResume')
      return Buffer.from(`*HQ,${this.uniqueId},S20,${time},1,0#`);
    const data = customCommandData(command);
    return command.type === 'custom' && data ? Buffer.from(data, 'ascii') : undefined;
  }

  private takeFrame(): Buffer | undefined {
    const start = this.pending.findIndex((byte) => byte === 0x2a || byte === 0x24);
    if (start < 0) {
      this.pending = Buffer.alloc(0);
      return undefined;
    }
    this.pending = this.pending.subarray(start);
    if (this.pending[0] === 0x2a) {
      const end = this.pending.indexOf(0x23);
      if (end < 0) return undefined;
      const frame = this.pending.subarray(0, end + 1);
      this.pending = this.pending.subarray(end + 1);
      return frame;
    }
    // As the legacy frame decoder: a buffer of exactly 45 bytes is a long frame, else 32.
    const length = this.pending.length === BINARY_LONG ? BINARY_LONG : BINARY_SHORT;
    if (this.pending.length < length) return undefined;
    const frame = this.pending.subarray(0, length);
    this.pending = this.pending.subarray(length);
    return frame;
  }

  private text(sentence: string) {
    const fields = sentence.replace(/^\*/, '').replace(/#$/, '').split(',');
    const [, uniqueId, type] = fields;
    if (!type) return undefined;
    const id = uniqueId || this.uniqueId;
    if (type === 'V0' || type === 'HTBT') {
      // Heartbeats are answered by echoing the header back.
      const battery = type === 'HTBT' && fields[3] ? Number(fields[3]) : undefined;
      return {
        uniqueId: id,
        packets: [
          {
            kind: 'status' as const,
            acknowledgement: Buffer.from(
              `${sentence.split(',').slice(0, 3).join(',').replace(/#$/, '')}#`,
            ),
            status: {
              attributes:
                battery !== undefined && Number.isFinite(battery) ? { batteryLevel: battery } : {},
              alarms: [],
            },
          },
        ],
      };
    }
    if (type === 'SMS')
      return {
        uniqueId: id,
        packets: [{ kind: 'commandResult' as const, result: fields.slice(3).join(',') }],
      };
    if (type === 'NBR') {
      const reply = Buffer.from(`*HQ,${id},V4,NBR,${utcStamp(this.now())}#`);
      return {
        uniqueId: id,
        packets: [
          {
            kind: 'status' as const,
            acknowledgement: reply,
            status: { attributes: {}, alarms: [] },
          },
        ],
      };
    }
    if (!/^V(\d+|I\d+|4)$/.test(type)) return { uniqueId: id, packets: [] };

    const packets: ProtocolPacket[] = [];
    let index = 3;
    if (type === 'V4') {
      // A command reply: "V4,S20,DONE,<server time>,<hhmmss>,A,...", followed by a position.
      const validity = fields.findIndex((field, position) => position > 4 && /^[AV]$/.test(field));
      if (validity < 0) return { uniqueId: id, packets: [] };
      packets.push({ kind: 'commandResult', result: fields.slice(3, validity - 1).join(',') });
      index = validity - 1;
    }
    const position = this.textPosition(fields, index, sentence);
    if (position)
      packets.push({
        kind: 'positions',
        positions: [position],
        acknowledgement:
          type === 'V1' && id ? Buffer.from(`*HQ,${id},V4,V1,${utcStamp(this.now())}#`) : EMPTY,
      });
    return { uniqueId: id, packets };
  }

  private textPosition(
    fields: string[],
    start: number,
    sentence: string,
  ): DecodedPosition | undefined {
    const time = fields[start] ?? '';
    const validity = fields[start + 1] ?? '';
    const latitude = coordinate(fields[start + 2], fields[start + 3]);
    const longitude = coordinate(fields[start + 4], fields[start + 5]);
    if (latitude === undefined || longitude === undefined || (latitude === 0 && longitude === 0))
      return undefined;
    const speedKnots = Number((fields[start + 6] ?? '').trim()) || 0;
    const courseDeg = Number(fields[start + 7]) || 0;
    // An optional battery field may sit between course and date.
    let next = start + 8;
    if (!/^(\d{6})?$/.test(fields[next] ?? '') && /^\d{6}$/.test(fields[next + 1] ?? '')) next += 1;
    const date = fields[next] ?? '';
    const fixTime = /^\d{6}$/.test(date) && /^\d{6}$/.test(time) ? utc(date, time) : this.now();
    // Status is the first 8-hex field after the date (some models put SIM details first).
    const status = fields.slice(next + 1, next + 5).find((field) => /^[0-9A-Fa-f]{8}$/.test(field));
    const flags = status
      ? decodeStatus(Number.parseInt(status, 16))
      : { attributes: {}, alarms: [] };
    return {
      messageId: stableMessageId('h02', Buffer.from(sentence)),
      fixTime,
      valid: validity === 'A' || /^\d+$/.test(validity),
      latitude,
      longitude,
      speedKmh: round(speedKnots * KNOTS_TO_KMH),
      courseDeg,
      attributes: flags.attributes,
      ...(flags.alarms.length ? { alarms: flags.alarms } : {}),
    };
  }

  private binary(frame: Buffer) {
    // Binary H02 is BCD throughout, so the hex digits are the decimal digits.
    const digits = frame.toString('hex');
    const uniqueId = digits.slice(2, 12);
    const at = (byte: number, count: number) => Number(digits.slice(byte * 2, byte * 2 + count));
    const fixTime = Date.UTC(
      2000 + at(11, 2),
      at(10, 2) - 1,
      at(9, 2),
      at(6, 2),
      at(7, 2),
      at(8, 2),
    );
    let latitude = at(12, 2) + at(13, 6) / 10_000 / 60;
    const batteryByte = frame[16] ?? 0;
    // Longitude: three degree digits, then MM.mmmm as six digits, sharing nibbles with the flags.
    const lonDigits = digits.slice(34, 43);
    let longitude = Number(lonDigits.slice(0, 3)) + Number(lonDigits.slice(3, 9)) / 10_000 / 60;
    const flags = (frame[21] ?? 0) & 0x0f;
    if ((flags & 0x04) === 0) latitude = -latitude;
    if ((flags & 0x08) === 0) longitude = -longitude;
    const speedKnots = Number(digits.slice(44, 47));
    const courseDeg = ((frame[23] ?? 0) & 0x0f) * 100 + Number(digits.slice(48, 50));
    const status = decodeStatus(frame.readUInt32BE(25));
    const battery = binaryBattery(batteryByte);
    const position: DecodedPosition = {
      messageId: stableMessageId('h02', frame),
      fixTime,
      valid: (flags & 0x02) !== 0,
      latitude: round(latitude, 6),
      longitude: round(longitude, 6),
      speedKmh: round(speedKnots * KNOTS_TO_KMH),
      courseDeg,
      attributes: {
        ...status.attributes,
        ...(battery === undefined ? {} : { batteryLevel: battery }),
      },
      ...(status.alarms.length ? { alarms: status.alarms } : {}),
    };
    if (!Number.isFinite(fixTime)) return undefined;
    return {
      uniqueId,
      packets: [{ kind: 'positions' as const, positions: [position], acknowledgement: EMPTY }],
    };
  }
}

/**
 * Status word, active-low: a cleared bit means the alarm is on. The legacy decoder reports the
 * first match only, in this order.
 */
function decodeStatus(status: number) {
  const bit = (index: number) => Math.floor(status / 2 ** index) % 2 === 1;
  const alarms: string[] = [];
  if (!bit(0)) alarms.push('vibration');
  else if (!bit(1) || !bit(18)) alarms.push('sos');
  else if (!bit(2)) alarms.push('overspeed');
  else if (!bit(19)) alarms.push('powerCut');
  return { attributes: { ignition: bit(10), status }, alarms };
}

function binaryBattery(value: number): number | undefined {
  if (value === 0) return undefined;
  if (value <= 3) return (value - 1) * 10;
  if (value <= 6) return (value - 1) * 20;
  if (value <= 100) return value;
  if (value >= 0xf1 && value <= 0xf6) return value - 0xf0;
  return undefined;
}

/** DDMM.MMMM, DDMMmmmm (no dot) or -DD-MM.MMMM, with N/S/E/W. */
function coordinate(value: string | undefined, hemisphere: string | undefined): number | undefined {
  if (!value || !hemisphere || !/^[NSEW]$/.test(hemisphere)) return undefined;
  let degrees: number;
  let minutes: number;
  const dashed = /^-(\d+)-(\d+(?:\.\d+)?)$/.exec(value);
  if (dashed) {
    degrees = Number(dashed[1]);
    minutes = Number(dashed[2]);
  } else if (value.includes('.')) {
    const [whole = '', fraction = ''] = value.split('.');
    degrees = Number(whole.slice(0, -2) || '0');
    minutes = Number(`${whole.slice(-2)}.${fraction}`);
  } else if (/^\d{7,}$/.test(value)) {
    degrees = Number(value.slice(0, -6));
    minutes = Number(`${value.slice(-6, -4)}.${value.slice(-4)}`);
  } else return undefined;
  if (!Number.isFinite(degrees) || !Number.isFinite(minutes)) return undefined;
  const result = degrees + minutes / 60;
  return round(hemisphere === 'S' || hemisphere === 'W' ? -result : result, 6);
}

function utc(date: string, time: string) {
  return Date.UTC(
    2000 + Number(date.slice(4, 6)),
    Number(date.slice(2, 4)) - 1,
    Number(date.slice(0, 2)),
    Number(time.slice(0, 2)),
    Number(time.slice(2, 4)),
    Number(time.slice(4, 6)),
  );
}

function utcStamp(now: number) {
  return new Date(now).toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

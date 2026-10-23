import {
  concatPending,
  customCommandData,
  stableMessageId,
  type DecodedPosition,
  type ProtocolCommand,
  type ProtocolDecoder,
  type ProtocolPacket,
} from './common';

const HEADER = 0x7878;
const MSG_LOGIN = 0x01;
const MSG_GPS_2 = 0x08;
const MSG_GPS_OFFLINE_2 = 0x09;
const MSG_GPS = 0x10;
const MSG_GPS_OFFLINE = 0x11;
const MSG_STATUS = 0x13;
const MSG_TIME_UPDATE = 0x30;
const MSG_VIBRATION = 0x94;
const MSG_SOS_ALARM = 0x99;

/**
 * Topin (ZX series personal trackers and watches): GT06-style `7878 <length> <type> ... 0d0a`
 * frames. The login, GPS and status messages are answered; the time is sent after login and
 * whenever the tracker asks. Ported from the legacy server's Topin decoder.
 */
export class TopinDecoder implements ProtocolDecoder {
  readonly protocol = 'topin' as const;
  private pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  constructor(private readonly now: () => number = Date.now) {}

  push(chunk: Buffer): ProtocolPacket[] {
    this.pending = concatPending(this.pending, chunk);
    const packets: ProtocolPacket[] = [];
    for (let frame = this.takeFrame(); frame; frame = this.takeFrame())
      packets.push(...this.frame(frame));
    return packets;
  }

  /** Topin trackers take protocol bytes (hex) through `custom`; there is no relay. */
  encodeCommand(command: ProtocolCommand): Buffer | undefined {
    const data = customCommandData(command);
    return command.type === 'custom' && data && /^([0-9a-fA-F]{2})+$/.test(data)
      ? Buffer.from(data, 'hex')
      : undefined;
  }

  /**
   * The length byte is trusted when CRLF sits where it says; some firmware miscounts it (the login
   * in the legacy tests), and then the frame runs to the next CRLF.
   */
  private takeFrame(): Buffer | undefined {
    let start = -1;
    for (let index = 0; index + 1 < this.pending.length; index += 1)
      if (this.pending.readUInt16BE(index) === HEADER) {
        start = index;
        break;
      }
    if (start < 0) {
      this.pending = this.pending.subarray(Math.max(0, this.pending.length - 1));
      return undefined;
    }
    this.pending = this.pending.subarray(start);
    if (this.pending.length < 6) return undefined;
    const declared = 3 + (this.pending[2] ?? 0) + 2;
    let end: number;
    if (this.pending.length >= declared && this.pending.readUInt16BE(declared - 2) === 0x0d0a)
      end = declared;
    else {
      const crlf = this.pending.indexOf('\r\n', 4);
      if (crlf < 0) return undefined;
      end = crlf + 2;
    }
    const frame = this.pending.subarray(0, end);
    this.pending = this.pending.subarray(end);
    return frame;
  }

  private reply(type: number, content: Buffer) {
    const frame = Buffer.alloc(4 + content.length + 2);
    frame.writeUInt16BE(HEADER, 0);
    frame[2] = content.length || 1;
    frame[3] = type;
    content.copy(frame, 4);
    frame.writeUInt16BE(0x0d0a, frame.length - 2);
    return frame;
  }

  private timeUpdate() {
    const now = new Date(this.now());
    const content = Buffer.alloc(7);
    content.writeUInt16BE(now.getUTCFullYear(), 0);
    content.set(
      [
        now.getUTCMonth() + 1,
        now.getUTCDate(),
        now.getUTCHours(),
        now.getUTCMinutes(),
        now.getUTCSeconds(),
      ],
      2,
    );
    return this.reply(MSG_TIME_UPDATE, content);
  }

  private frame(frame: Buffer): ProtocolPacket[] {
    const type = frame[3];
    const body = frame.subarray(4, frame.length - 2);
    const none = { attributes: {}, alarms: [] as string[] };
    switch (type) {
      case MSG_LOGIN: {
        const uniqueId = body.subarray(0, 8).toString('hex').slice(1);
        const reply = frame.subarray(0, 3);
        const login = Buffer.concat([
          Buffer.from([reply[0]!, reply[1]!, reply[2]!, MSG_LOGIN, 0x01, 0x0d, 0x0a]),
          this.timeUpdate(),
        ]);
        return [{ kind: 'identity', uniqueId, acknowledgement: login }];
      }
      case MSG_TIME_UPDATE:
        return [{ kind: 'status', status: none, acknowledgement: this.timeUpdate() }];
      case MSG_GPS:
      case MSG_GPS_OFFLINE: {
        const position = gps(body, frame);
        // Answered with the fix time the tracker sent.
        const acknowledgement = Buffer.concat([
          frame.subarray(0, 4),
          body.subarray(0, 6),
          Buffer.from([0x0d, 0x0a]),
        ]);
        return position
          ? [{ kind: 'positions', positions: [position], acknowledgement }]
          : [{ kind: 'status', status: none, acknowledgement }];
      }
      case MSG_GPS_2:
      case MSG_GPS_OFFLINE_2: {
        const position = body.length > 2 ? gps2(body, frame, type === MSG_GPS_2) : undefined;
        return position
          ? [{ kind: 'positions', positions: [position], acknowledgement: Buffer.alloc(0) }]
          : [];
      }
      case MSG_STATUS: {
        const attributes: Record<string, number | boolean> = { batteryLevel: body[0] ?? 0 };
        if (body.length >= 5) attributes.rssi = body[4]!;
        return [
          {
            kind: 'status',
            status: { attributes, alarms: [] },
            acknowledgement: Buffer.concat([frame.subarray(0, 4), body, Buffer.from([0x0d, 0x0a])]),
          },
        ];
      }
      case MSG_VIBRATION:
        return [
          {
            kind: 'status',
            status: { attributes: {}, alarms: ['vibration'] },
            acknowledgement: Buffer.alloc(0),
          },
        ];
      case MSG_SOS_ALARM:
        return [
          {
            kind: 'status',
            status: { attributes: {}, alarms: ['sos'] },
            acknowledgement: Buffer.alloc(0),
          },
        ];
      default:
        return [];
    }
  }
}

/** GT06-style fix: date, satellites, latitude, longitude (1/1,800,000°), speed, course and flags. */
function gps(body: Buffer, frame: Buffer): DecodedPosition | undefined {
  if (body.length < 18) return undefined;
  const fixTime = Date.UTC(2000 + body[0]!, body[1]! - 1, body[2], body[3], body[4], body[5]);
  let latitude = body.readUInt32BE(7) / 1_800_000;
  let longitude = body.readUInt32BE(11) / 1_800_000;
  const flags = body.readUInt16BE(16);
  if ((flags & 0x0400) === 0) latitude = -latitude;
  if ((flags & 0x0800) !== 0) longitude = -longitude;
  const alarmBits = body.length >= 21 ? body[20]! : 0;
  const alarms = [
    alarmBits & 0x01 ? 'vibration' : undefined,
    alarmBits & 0x02 ? 'overspeed' : undefined,
    alarmBits & 0x10 ? 'lowPower' : undefined,
  ].filter((item): item is string => Boolean(item));
  return {
    messageId: stableMessageId('topin', frame),
    fixTime,
    valid: (flags & 0x1000) !== 0,
    latitude,
    longitude,
    speedKmh: body[15]!,
    courseDeg: flags & 0x03ff,
    ...(body.length >= 20 ? { altitudeM: body.readInt16BE(18) } : {}),
    attributes: { satellites: body[6]! & 0x0f },
    // The legacy decoder reports the first alarm bit only.
    ...(alarms.length ? { alarms: [alarms[0]!] } : {}),
  };
}

/** Second GPS format: signed degrees with a millionths fraction. */
function gps2(body: Buffer, frame: Buffer, valid: boolean): DecodedPosition | undefined {
  if (body.length < 25) return undefined;
  const coordinate = (offset: number) => {
    const negative = (body[offset + 1]! & 0xf0) > 0;
    const value = body[offset]! + (body.readUIntBE(offset + 1, 3) & 0x0fffff) / 1_000_000;
    return negative ? -value : value;
  };
  return {
    messageId: stableMessageId('topin', frame),
    fixTime: Date.UTC(2000 + body[0]!, body[1]! - 1, body[2], body[3], body[4], body[5]),
    valid,
    latitude: coordinate(6),
    longitude: coordinate(10),
    speedKmh: body[22]!,
    courseDeg: body[23]! * 2,
    attributes: { satellites: body[24]! },
  };
}

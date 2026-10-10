import {
  concatPending,
  customCommandData,
  stableMessageId,
  type DecodedPosition,
  type ProtocolCommand,
  type ProtocolDecoder,
  type ProtocolPacket,
} from './common';

const EMPTY = Buffer.alloc(0);
/** Messages answered with their own type, as the legacy decoder did. */
const ECHOED = new Set(['LK', 'TKQ', 'TKQ2']);

/**
 * Watch protocol (3G/4G GPS watches and personal trackers): `[MM*<id>*LLLL*TYPE,...]`, where LLLL
 * is the hex content length; some models add a 4-hex index after the id. Ported from the legacy
 * server's watch decoder. Health readings (heart rate and so on) are not tracked here.
 */
export class WatchDecoder implements ProtocolDecoder {
  readonly protocol = 'watch' as const;
  private pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private uniqueId?: string;
  private manufacturer = '3G';
  private index?: string;

  push(chunk: Buffer): ProtocolPacket[] {
    this.pending = concatPending(this.pending, chunk);
    const packets: ProtocolPacket[] = [];
    for (let frame = this.takeFrame(); frame; frame = this.takeFrame())
      packets.push(...this.frame(frame));
    return packets;
  }

  /** Watches have no relay; only protocol text sent as `custom` is supported. */
  encodeCommand(command: ProtocolCommand): Buffer | undefined {
    const data = customCommandData(command);
    return command.type === 'custom' && data && this.uniqueId ? this.message(data) : undefined;
  }

  private message(content: string) {
    const length = content.length.toString(16).padStart(4, '0');
    const index = this.index ? `${this.index}*` : '';
    return Buffer.from(
      `[${this.manufacturer}*${this.uniqueId}*${index}${length}*${content}]`,
      'ascii',
    );
  }

  private takeFrame(): Buffer | undefined {
    const start = this.pending.indexOf(0x5b);
    if (start < 0) {
      this.pending = Buffer.alloc(0);
      return undefined;
    }
    this.pending = this.pending.subarray(start);
    const header = parseHeader(this.pending);
    if (!header) return undefined;
    const end = header.contentStart + header.length;
    if (this.pending.length <= end) return undefined;
    const frame = this.pending.subarray(0, end + 1);
    this.pending = this.pending.subarray(end + 1);
    return frame;
  }

  private frame(frame: Buffer): ProtocolPacket[] {
    const header = parseHeader(frame)!;
    const content = frame.subarray(header.contentStart, frame.length - 1).toString('ascii');
    const packets: ProtocolPacket[] = [];
    this.manufacturer = header.manufacturer;
    this.index = header.index;
    if (header.id !== this.uniqueId) {
      this.uniqueId = header.id;
      packets.push({ kind: 'identity', uniqueId: header.id, acknowledgement: EMPTY });
    }
    const comma = content.indexOf(',');
    const type = comma < 0 ? content : content.slice(0, comma);
    const data = comma < 0 ? '' : content.slice(comma + 1);
    if (type === 'INIT') {
      packets.push({
        kind: 'status',
        status: { attributes: {}, alarms: [] },
        acknowledgement: this.message('INIT,1'),
      });
    } else if (ECHOED.has(type)) {
      const values = data.split(',');
      const battery = type === 'LK' && values.length >= 3 ? Number(values[2]) : undefined;
      packets.push({
        kind: 'status',
        acknowledgement: this.message(type),
        status: {
          attributes:
            battery !== undefined && Number.isFinite(battery) ? { batteryLevel: battery } : {},
          alarms: [],
        },
      });
    } else if (/^(UD|AL|WT)/.test(type)) {
      const alarm = type.startsWith('AL');
      const position = decodePosition(data, frame, alarm);
      const acknowledgement = alarm ? this.message('AL') : EMPTY;
      if (position) packets.push({ kind: 'positions', positions: [position], acknowledgement });
      else if (alarm)
        packets.push({
          kind: 'status',
          status: { attributes: {}, alarms: ['general'] },
          acknowledgement,
        });
    }
    return packets;
  }
}

interface Header {
  manufacturer: string;
  id: string;
  index?: string;
  length: number;
  contentStart: number;
}

/** `[MM*id*[index*]LLLL*`: the index is present when a 4-hex field follows another field. */
function parseHeader(buffer: Buffer): Header | undefined {
  const text = buffer.subarray(0, Math.min(buffer.length, 64)).toString('ascii');
  const match = /^\[([A-Za-z0-9]{2})\*([^*]+)\*(?:([0-9A-Fa-f]{4})\*)?([0-9A-Fa-f]{4})\*/.exec(
    text,
  );
  if (!match) return undefined;
  return {
    manufacturer: match[1]!,
    id: match[2]!,
    index: match[3],
    length: Number.parseInt(match[4]!, 16),
    contentStart: match[0].length,
  };
}

/** `ddmmyy,hhmmss,A,lat,N,lon,E,speed km/h,course,altitude,satellites,rssi,battery,steps,tumbles,status,...` */
function decodePosition(data: string, frame: Buffer, alarm: boolean): DecodedPosition | undefined {
  const fields = data.split(',');
  const [date = '', time = '', validity = ''] = fields;
  if (!/^\d{6}$/.test(date) || !/^\d{6}$/.test(time) || !/^[AV]$/.test(validity)) return undefined;
  const latitude = signed(fields[3], fields[4]);
  const longitude = signed(fields[5], fields[6]);
  if (latitude === undefined || longitude === undefined) return undefined;
  const number = (index: number) => {
    const value = Number(fields[index]);
    return Number.isFinite(value) ? value : 0;
  };
  const status = Number.parseInt(fields[15] ?? '0', 16) || 0;
  const alarms = [statusAlarm(status) ?? (alarm ? 'general' : undefined)].filter(
    (item): item is string => Boolean(item),
  );
  return {
    messageId: stableMessageId('watch', frame),
    fixTime: Date.UTC(
      2000 + Number(date.slice(4, 6)),
      Number(date.slice(2, 4)) - 1,
      Number(date.slice(0, 2)),
      Number(time.slice(0, 2)),
      Number(time.slice(2, 4)),
      Number(time.slice(4, 6)),
    ),
    valid: validity === 'A',
    latitude,
    longitude,
    speedKmh: number(7),
    courseDeg: number(8),
    altitudeM: number(9),
    attributes: {
      satellites: number(10),
      rssi: number(11),
      batteryLevel: number(12),
      steps: number(13),
      status,
      ...(status & 0x10 ? { motion: true } : {}),
    },
    ...(alarms.length ? { alarms } : {}),
  };
}

/** Decimal degrees; a southern or western hemisphere makes the value negative once. */
function signed(value: string | undefined, hemisphere: string | undefined) {
  const number = Number((value ?? '').trim());
  if (!value?.trim() || !Number.isFinite(number)) return undefined;
  return hemisphere === 'S' || hemisphere === 'W' ? -Math.abs(number) : number;
}

/** The legacy decoder's status-bit alarms, first match only. */
function statusAlarm(status: number): string | undefined {
  const bit = (index: number) => Math.floor(status / 2 ** index) % 2 === 1;
  if (bit(0)) return 'lowBattery';
  if (bit(1)) return 'geofenceExit';
  if (bit(2)) return 'geofenceEnter';
  if (bit(14)) return 'powerCut';
  if (bit(16)) return 'sos';
  if (bit(17)) return 'lowBattery';
  if (bit(18)) return 'geofenceExit';
  if (bit(19)) return 'geofenceEnter';
  if (bit(20)) return 'removing';
  if (bit(21) || bit(22)) return 'fallDown';
  return undefined;
}

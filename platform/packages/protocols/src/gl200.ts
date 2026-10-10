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

/** Report types that are alarms (the legacy decoder's mapping). */
const ALARMS: Record<string, string> = {
  SOS: 'sos',
  SPD: 'overspeed',
  TOW: 'tow',
  IDL: 'idle',
  PNA: 'powerOn',
  PFA: 'powerOff',
  EPN: 'powerRestored',
  MPN: 'powerRestored',
  EPF: 'powerCut',
  MPF: 'powerCut',
  BPL: 'lowBattery',
  STT: 'movement',
  SWG: 'geofence',
  TMP: 'temperature',
  TEM: 'temperature',
  JDR: 'jamming',
  JDS: 'jamming',
};
const IGNITION: Record<string, boolean> = { IGN: true, VGN: true, IGF: false, VGF: false };

/**
 * Queclink GL/GV series text protocol: `+RESP:GTxxx,<version>,<imei>,...$` (and `+BUFF:` for
 * replayed reports). Models differ in the fields around the fix, so positions are found by the
 * location block every model shares: hdop, speed km/h, course, altitude, longitude, latitude,
 * yyyyMMddHHmmss. One report can carry several. Heartbeats are answered with +SACK.
 */
export class Gl200Decoder implements ProtocolDecoder {
  readonly protocol = 'gl200' as const;
  private pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private uniqueId?: string;

  push(chunk: Buffer): ProtocolPacket[] {
    this.pending = concatPending(this.pending, chunk);
    const packets: ProtocolPacket[] = [];
    for (;;) {
      const end = this.pending.indexOf(0x24);
      if (end < 0) break;
      const sentence = this.pending.subarray(0, end).toString('ascii').trim();
      this.pending = this.pending.subarray(end + 1);
      const start = sentence.indexOf('+');
      if (start >= 0) packets.push(...this.sentence(sentence.slice(start)));
    }
    return packets;
  }

  /**
   * GTOUT switches output 1, which drives the relay. The command carries the device password
   * (payload.password), empty unless the fleet changed it on the tracker.
   */
  encodeCommand(command: ProtocolCommand): Buffer | undefined {
    const password = typeof command.payload.password === 'string' ? command.payload.password : '';
    if (command.type === 'engineStop')
      return Buffer.from(`AT+GTOUT=${password},1,,,0,0,0,0,0,0,0,,,,,,,FFFF$`);
    if (command.type === 'engineResume')
      return Buffer.from(`AT+GTOUT=${password},0,,,0,0,0,0,0,0,0,,,,,,,FFFF$`);
    const data = customCommandData(command);
    return command.type === 'custom' && data ? Buffer.from(data, 'ascii') : undefined;
  }

  private sentence(sentence: string): ProtocolPacket[] {
    const packets: ProtocolPacket[] = [];
    const fields = sentence.split(',');
    const header = /^\+(RESP|BUFF|ACK):GT([A-Z]{3})$/.exec(fields[0] ?? '');
    if (!header) return packets;
    const [, kind, type = ''] = header;
    const imei = fields[2] ?? '';
    if (!/^(\d{15}|[0-9A-Fa-f]{14})$/.test(imei)) return packets;
    if (imei !== this.uniqueId) {
      this.uniqueId = imei;
      packets.push({ kind: 'identity', uniqueId: imei, acknowledgement: EMPTY });
    }
    const count = fields.at(-1) ?? '';
    if (kind === 'ACK') {
      if (type === 'HBD')
        packets.push({
          kind: 'status',
          status: { attributes: {}, alarms: [] },
          acknowledgement: Buffer.from(`+SACK:GTHBD,${fields[1] ?? ''},${count}$`),
        });
      // Other acknowledgements answer our commands.
      else
        packets.push({
          kind: 'commandResult',
          result: `GT${type},${fields.slice(3, -2).join(',')}`,
        });
      return packets;
    }
    const alarm = ALARMS[type];
    const ignition = IGNITION[type];
    const attributes: Record<string, number | string | boolean> = { type };
    if (ignition !== undefined) attributes.ignition = ignition;
    const positions = locations(fields).map((location, index) =>
      position(location, attributes, alarm, sentence, index),
    );
    if (positions.length) packets.push({ kind: 'positions', positions, acknowledgement: EMPTY });
    else if (alarm || ignition !== undefined)
      packets.push({
        kind: 'status',
        status: { attributes, alarms: alarm ? [alarm] : [] },
        acknowledgement: EMPTY,
      });
    return packets;
  }
}

interface Location {
  hdop?: number;
  speedKmh: number;
  courseDeg: number;
  altitudeM: number;
  longitude: number;
  latitude: number;
  fixTime: number;
}

/** Every `...,lon,lat,yyyyMMddHHmmss` triple, with the four fields before it. */
function locations(fields: string[]): Location[] {
  const result: Location[] = [];
  for (let index = 4; index + 2 < fields.length; index += 1) {
    const [lon, lat, time] = [fields[index], fields[index + 1], fields[index + 2]];
    if (
      !/^-?\d{1,3}\.\d{6}$/.test(lon ?? '') ||
      !/^-?\d{1,2}\.\d{6}$/.test(lat ?? '') ||
      !/^\d{14}$/.test(time ?? '')
    )
      continue;
    const number = (offset: number) => {
      const value = Number(fields[index + offset]);
      return fields[index + offset] === '' || !Number.isFinite(value) ? undefined : value;
    };
    result.push({
      hdop: number(-4),
      speedKmh: number(-3) ?? 0,
      courseDeg: number(-2) ?? 0,
      altitudeM: number(-1) ?? 0,
      longitude: Number(lon),
      latitude: Number(lat),
      fixTime: Date.UTC(
        Number(time!.slice(0, 4)),
        Number(time!.slice(4, 6)) - 1,
        Number(time!.slice(6, 8)),
        Number(time!.slice(8, 10)),
        Number(time!.slice(10, 12)),
        Number(time!.slice(12, 14)),
      ),
    });
    index += 2;
  }
  return result;
}

function position(
  location: Location,
  attributes: Record<string, number | string | boolean>,
  alarm: string | undefined,
  sentence: string,
  index: number,
): DecodedPosition {
  return {
    messageId: stableMessageId('gl200', Buffer.from(sentence), index),
    fixTime: location.fixTime,
    // As the legacy decoder: a report with coordinates is a fix, whatever the accuracy field says.
    valid: true,
    latitude: location.latitude,
    longitude: location.longitude,
    speedKmh: location.speedKmh,
    courseDeg: location.courseDeg,
    altitudeM: location.altitudeM,
    attributes: { ...attributes, ...(location.hdop === undefined ? {} : { hdop: location.hdop }) },
    ...(alarm ? { alarms: [alarm] } : {}),
  };
}

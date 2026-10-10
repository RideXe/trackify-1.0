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

/** BO01 alarm digit (the legacy decoder's mapping). */
const BO01_ALARMS: Record<string, string> = {
  '1': 'accident',
  '2': 'sos',
  '3': 'vibration',
  '4': 'lowspeed',
  '5': 'overspeed',
  '6': 'geofenceExit',
};
const BQ81_ALARMS: Record<string, string> = {
  '0': 'lowBattery',
  '1': 'overspeed',
  '2': 'idle',
  '3': 'hardAcceleration',
  '4': 'hardBraking',
  '5': 'temperature',
};
/** Type codes that are alarms or ignition changes, with their DW3x/DW5x equivalents. */
const TYPE_ALARMS: Record<string, string> = {
  ZC11: 'movement',
  DW31: 'movement',
  DW51: 'movement',
  ZC12: 'lowBattery',
  DW32: 'lowBattery',
  DW52: 'lowBattery',
  ZC13: 'powerCut',
  DW33: 'powerCut',
  DW53: 'powerCut',
  ZC17: 'removing',
  DW37: 'removing',
  DW57: 'removing',
  ZC25: 'sos',
  DW3E: 'sos',
  DW5E: 'sos',
  ZC26: 'tampering',
  DW3F: 'tampering',
  DW5F: 'tampering',
  ZC27: 'lowPower',
  DW40: 'lowPower',
  DW60: 'lowPower',
};
const IGNITION_ON = new Set(['ZC15', 'DW35', 'DW55', 'ZC29', 'DW42', 'DW62']);
const IGNITION_OFF = new Set(['ZC16', 'DW36', 'DW56']);

const POSITION =
  /^\((.{12})(.{4})(?:,ALARM,(\d),\d+,|(\d*))(\d{2})(\d{2})(\d{2})([AV]) *(\d*)(\d{2}\.\d+)([NS]) *(\d*)(\d{2}\.\d+)([EW])([ \d.]{1,5})(\d{2})(\d{2})(\d{2})(?:([ \d.]{6})([01])([01])([0-9A-Fa-f])([0-9A-Fa-f])([0-9A-Fa-f])([0-9A-Fa-f]{3})L([0-9A-Fa-f]+))?.*?([+-]\d{3}\.\d)?\)$/;

/**
 * TK103 (Xexun-style) protocol: `(<12-char id><4-char type><data>)`. The device id is the 12
 * characters after the bracket, which is what the vehicle's tracker id must be set to.
 * Ported from the legacy server's TK103 decoder and encoder (main position format).
 */
export class Tk103Decoder implements ProtocolDecoder {
  readonly protocol = 'tk103' as const;
  private pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private uniqueId?: string;

  push(chunk: Buffer): ProtocolPacket[] {
    this.pending = concatPending(this.pending, chunk);
    const packets: ProtocolPacket[] = [];
    for (;;) {
      const start = this.pending.indexOf(0x28);
      if (start < 0) {
        this.pending = Buffer.alloc(0);
        break;
      }
      const end = this.pending.indexOf(0x29, start);
      if (end < 0) {
        this.pending = this.pending.subarray(start);
        break;
      }
      const sentence = this.pending.subarray(start, end + 1).toString('ascii');
      this.pending = this.pending.subarray(end + 1);
      packets.push(...this.sentence(sentence));
    }
    return packets;
  }

  encodeCommand(command: ProtocolCommand): Buffer | undefined {
    if (!this.uniqueId) return undefined;
    if (command.type === 'engineStop') return Buffer.from(`(${this.uniqueId}AV010)`);
    if (command.type === 'engineResume') return Buffer.from(`(${this.uniqueId}AV011)`);
    const data = customCommandData(command);
    return command.type === 'custom' && data ? Buffer.from(`(${this.uniqueId}${data})`) : undefined;
  }

  private sentence(sentence: string): ProtocolPacket[] {
    if (sentence.length < 17) return [];
    const id = sentence.slice(1, 13);
    const type = sentence.slice(13, 17);
    const packets: ProtocolPacket[] = [];
    // The login is answered AP01HSO and positions sent on request (BP05) AP05.
    const reply = type === 'BP00' ? `(${id}AP01HSO)` : type === 'BP05' ? `(${id}AP05)` : undefined;
    if (id !== this.uniqueId) {
      this.uniqueId = id;
      packets.push({
        kind: 'identity',
        uniqueId: id,
        acknowledgement: type === 'BP00' ? Buffer.from(reply!) : EMPTY,
      });
      if (type === 'BP00') return packets;
    } else if (type === 'BP00') {
      packets.push({
        kind: 'status',
        status: { attributes: {}, alarms: [] },
        acknowledgement: Buffer.from(reply!),
      });
      return packets;
    }
    if (type === 'ZC03') {
      packets.push({ kind: 'commandResult', result: sentence.slice(17, -1) });
      return packets;
    }
    const position = decodePosition(sentence);
    const acknowledgement = reply ? Buffer.from(reply) : EMPTY;
    if (position) packets.push({ kind: 'positions', positions: [position], acknowledgement });
    else if (acknowledgement.length)
      packets.push({ kind: 'status', status: { attributes: {}, alarms: [] }, acknowledgement });
    return packets;
  }
}

function decodePosition(sentence: string): DecodedPosition | undefined {
  const match = POSITION.exec(sentence);
  if (!match) return undefined;
  const [
    ,
    ,
    type = '',
    commaAlarm,
    data = '',
    yy,
    mm,
    dd,
    validity,
    latDeg,
    latMin,
    latHem,
    lonDeg,
    lonMin,
    lonHem,
    speed,
    hh,
    mi,
    ss,
    course,
    charge,
    ignition,
    io1,
    io2,
    ,
    fuel,
    odometer,
    temperature,
  ] = match;
  const alarms: string[] = [];
  const attributes: Record<string, number | string | boolean> = { type };
  if (type === 'BO01' && BO01_ALARMS[data.charAt(0)]) alarms.push(BO01_ALARMS[data.charAt(0)]!);
  if (type === 'BQ81' && commaAlarm && BQ81_ALARMS[commaAlarm])
    alarms.push(BQ81_ALARMS[commaAlarm]);
  if (TYPE_ALARMS[type]) alarms.push(TYPE_ALARMS[type]);
  if (IGNITION_ON.has(type)) attributes.ignition = true;
  if (IGNITION_OFF.has(type)) attributes.ignition = false;
  if (charge !== undefined) {
    attributes.charge = charge === '0';
    attributes.ignition = ignition === '1';
    const mask1 = Number.parseInt(io1!, 16);
    const mask2 = Number.parseInt(io2!, 16);
    attributes.panic = (mask1 & 0x02) !== 0;
    attributes.blocked = (mask1 & 0x08) !== 0;
    attributes.door = (mask2 & 0x08) !== 0;
    attributes.fuel = Number.parseInt(fuel!, 16);
    attributes.odometer = Number.parseInt(odometer!, 16);
  }
  if (temperature) attributes.temp1 = Number(temperature);
  const latitude = (Number(latDeg || '0') + Number(latMin) / 60) * (latHem === 'S' ? -1 : 1);
  const longitude = (Number(lonDeg || '0') + Number(lonMin) / 60) * (lonHem === 'W' ? -1 : 1);
  if (latitude === 0 && longitude === 0) return undefined;
  const courseDeg = Number((course ?? '').trim());
  return {
    messageId: stableMessageId('tk103', Buffer.from(sentence)),
    fixTime: Date.UTC(
      2000 + Number(yy),
      Number(mm) - 1,
      Number(dd),
      Number(hh),
      Number(mi),
      Number(ss),
    ),
    valid: validity === 'A',
    latitude: Math.round(latitude * 1e6) / 1e6,
    longitude: Math.round(longitude * 1e6) / 1e6,
    speedKmh: Number((speed ?? '').trim()) || 0,
    courseDeg: Number.isFinite(courseDeg) ? courseDeg : 0,
    attributes,
    ...(alarms.length ? { alarms } : {}),
  };
}

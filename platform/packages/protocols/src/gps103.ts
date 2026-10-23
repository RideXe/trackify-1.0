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
const EMPTY = Buffer.alloc(0);

/** The second field names the message; these are alarms (the legacy decoder's mapping). */
const ALARMS: Record<string, string> = {
  'help me': 'sos',
  'low battery': 'lowBattery',
  stockade: 'geofence',
  move: 'movement',
  speed: 'overspeed',
  'door alarm': 'door',
  'ac alarm': 'powerCut',
  'accident alarm': 'accident',
  'sensor alarm': 'vibration',
  'bonnet alarm': 'bonnet',
  'footbrake alarm': 'footBrake',
  DTC: 'fault',
};

/**
 * GPS103 (Coban TK103B, GPS-103 and many clones): `imei:<id>,<event>,<local time>,...;` text.
 * A short `##,imei:<id>,A;` login is answered LOAD and a bare-IMEI heartbeat ON.
 * Ported from the legacy server's GPS103 decoder and encoder.
 */
export class Gps103Decoder implements ProtocolDecoder {
  readonly protocol = 'gps103' as const;
  private pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private uniqueId?: string;

  push(chunk: Buffer): ProtocolPacket[] {
    this.pending = concatPending(this.pending, chunk);
    const packets: ProtocolPacket[] = [];
    for (;;) {
      const end = this.pending.findIndex((byte) => byte === 0x3b || byte === 0x0a || byte === 0x0d);
      if (end < 0) break;
      const sentence = this.pending.subarray(0, end).toString('ascii').trim();
      this.pending = this.pending.subarray(end + 1);
      if (sentence) packets.push(...this.sentence(sentence));
    }
    return packets;
  }

  encodeCommand(command: ProtocolCommand): Buffer | undefined {
    if (!this.uniqueId) return undefined;
    const code = { engineStop: 'J', engineResume: 'K' }[command.type];
    if (code) return Buffer.from(`**,imei:${this.uniqueId},${code}`);
    const data = customCommandData(command);
    return command.type === 'custom' && data
      ? Buffer.from(`**,imei:${this.uniqueId},${data}`)
      : undefined;
  }

  private identify(uniqueId: string, packets: ProtocolPacket[], acknowledgement = EMPTY) {
    if (uniqueId === this.uniqueId) return false;
    this.uniqueId = uniqueId;
    packets.push({ kind: 'identity', uniqueId, acknowledgement });
    return true;
  }

  private sentence(raw: string): ProtocolPacket[] {
    const packets: ProtocolPacket[] = [];
    let sentence = raw;
    if (sentence.includes('imei:') && sentence.length <= 30) {
      const imei = /imei:(\d+)/.exec(sentence)?.[1];
      if (imei && !this.identify(imei, packets, Buffer.from('LOAD')))
        packets.push({
          kind: 'status',
          status: { attributes: {}, alarms: [] },
          acknowledgement: Buffer.from('LOAD'),
        });
      return packets;
    }
    if (/^\d/.test(sentence)) {
      const start = sentence.indexOf('imei:');
      if (start < 0) {
        // A heartbeat is the bare IMEI.
        if (!this.identify(sentence, packets, Buffer.from('ON')))
          packets.push({
            kind: 'status',
            status: { attributes: {}, alarms: [] },
            acknowledgement: Buffer.from('ON'),
          });
        return packets;
      }
      sentence = sentence.slice(start);
    }
    if (!sentence.startsWith('imei:')) return packets;
    const fields = sentence.slice(5).split(',');
    const [imei = '', event = ''] = fields;
    if (!/^\d+$/.test(imei)) return packets;
    if (/^(OBD|vr)/.test(event)) {
      this.identify(imei, packets);
      return packets;
    }
    // SOS is confirmed back to the tracker, which otherwise keeps repeating it.
    this.identify(imei, packets);
    const acknowledgement = event === 'help me' ? Buffer.from(`**,imei:${imei},E;`) : EMPTY;
    const alarm =
      ALARMS[event] ??
      (event.startsWith('T:') ? 'temperature' : event.startsWith('oil') ? 'fuelLeak' : undefined);
    const attributes: Record<string, number | string | boolean> = {};
    if (event === 'acc on') attributes.ignition = true;
    if (event === 'acc off') attributes.ignition = false;
    if (event === 'rfid' && fields[3]) attributes.driverUniqueId = fields[3];
    if (event && !alarm && !['tracker', 'acc on', 'acc off', 'rfid'].includes(event))
      attributes.event = event;
    const alarms = alarm ? [alarm] : [];

    const position = fields[4] === 'F' ? this.position(fields, raw, attributes, alarms) : undefined;
    if (position) packets.push({ kind: 'positions', positions: [position], acknowledgement });
    // No fix (L = cell towers only): alarms and ignition still count, at the last known place.
    else if (alarms.length || 'ignition' in attributes)
      packets.push({ kind: 'status', status: { attributes, alarms }, acknowledgement });
    return packets;
  }

  private position(
    fields: string[],
    raw: string,
    attributes: Record<string, number | string | boolean>,
    alarms: string[],
  ): DecodedPosition | undefined {
    const local = (fields[2] ?? '').replace(/\D/g, '');
    const utcTime = /^(\d{2})(\d{2})(\d{2})/.exec(fields[5] ?? '');
    const validity = fields[6];
    if (validity !== 'A' && validity !== 'V') return undefined;
    // Hemispheres may come before or after each coordinate.
    let index = 7;
    const hemisphere = (letters: string) => {
      const value = fields[index];
      if (value && letters.includes(value)) {
        index += 1;
        return value;
      }
      return undefined;
    };
    const beforeLat = hemisphere('NS');
    const latitudeText = fields[index++];
    const latHemisphere = hemisphere('NS') ?? beforeLat;
    const beforeLon = hemisphere('EW');
    const longitudeText = fields[index++];
    let lonHemisphere = hemisphere('EW');
    // Some firmware leaves the longitude hemisphere empty; it then counts as east.
    if (!lonHemisphere && fields[index] === '') index += 1;
    lonHemisphere ??= beforeLon;
    const latitude = degreesMinutes(latitudeText, latHemisphere);
    const longitude = degreesMinutes(longitudeText, lonHemisphere);
    if (latitude === undefined || longitude === undefined) return undefined;
    const number = (value: string | undefined) =>
      value === undefined || value === '' ? undefined : Number(value);
    const speedKnots = number(fields[index]) ?? 0;
    const courseDeg = number(fields[index + 1]) ?? 0;
    const altitudeM = number(fields[index + 2]);
    const ignition = fields[index + 3];
    const door = fields[index + 4];
    if (ignition === '0' || ignition === '1') attributes.ignition = ignition === '1';
    if (door === '0' || door === '1') attributes.door = door === '1';
    const fuel = /^(\d+(?:\.\d+)?)%$/.exec(fields[index + 5] ?? '');
    if (fuel) attributes.fuel1 = Number(fuel[1]);
    const temperature = /^([-+]?\d+)$/.exec(fields[index + 7] ?? '');
    if (temperature) attributes.temp1 = Number(temperature[1]);
    return {
      messageId: stableMessageId('gps103', Buffer.from(raw)),
      fixTime: fixTime(local, utcTime),
      valid: validity === 'A',
      latitude,
      longitude,
      speedKmh: Math.round(speedKnots * KNOTS_TO_KMH * 100) / 100,
      courseDeg: Number.isFinite(courseDeg) ? courseDeg : 0,
      ...(altitudeM !== undefined && Number.isFinite(altitudeM) ? { altitudeM } : {}),
      attributes,
      ...(alarms.length ? { alarms } : {}),
    };
  }
}

/**
 * The tracker reports local date and time plus UTC hh:mm:ss of the fix. As the legacy decoder,
 * the zone offset is the difference between local and UTC clock, wrapped to ±12 hours.
 */
function fixTime(local: string, utc: RegExpExecArray | null): number {
  if (local.length < 10 || !utc) return Date.now();
  const [year, month, day, hour, minute] = [0, 2, 4, 6, 8].map((offset) =>
    Number(local.slice(offset, offset + 2)),
  ) as [number, number, number, number, number];
  const [utcHour, utcMinute, utcSecond] = [Number(utc[1]), Number(utc[2]), Number(utc[3])];
  let delta = (hour - utcHour) * 60 + (minute - utcMinute);
  if (delta <= -12 * 60) delta += 24 * 60;
  else if (delta > 12 * 60) delta -= 24 * 60;
  return Date.UTC(2000 + year, month - 1, day, hour, minute, utcSecond) - delta * 60_000;
}

function degreesMinutes(
  value: string | undefined,
  hemisphere: string | undefined,
): number | undefined {
  const match = /^(\d+)(\d{2}\.\d+)$/.exec(value ?? '');
  if (!match) return undefined;
  const result = Number(match[1]) + Number(match[2]) / 60;
  return Math.round((hemisphere === 'S' || hemisphere === 'W' ? -result : result) * 1e6) / 1e6;
}

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

/** Event codes that are alarms (the legacy decoder's mapping). */
const ALARMS: Record<number, string> = {
  1: 'sos',
  17: 'lowBattery',
  18: 'lowPower',
  19: 'overspeed',
  20: 'geofenceEnter',
  21: 'geofenceExit',
  22: 'powerRestored',
  23: 'powerCut',
  36: 'tow',
  44: 'jamming',
  78: 'accident',
  90: 'hardCornering',
  91: 'hardCornering',
  129: 'hardBraking',
  130: 'hardAcceleration',
  135: 'fatigueDriving',
};

/**
 * Meitrack text protocol (MVT, T1, T3, T333 and similar): `$$<flag><length>,<imei>,<type>,...*CS`.
 * Ported from the legacy server's Meitrack decoder and encoder; the binary CCC/CCE and photo
 * messages of some newer models are not decoded.
 */
export class MeitrackDecoder implements ProtocolDecoder {
  readonly protocol = 'meitrack' as const;
  private pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private uniqueId?: string;

  push(chunk: Buffer): ProtocolPacket[] {
    this.pending = concatPending(this.pending, chunk);
    const packets: ProtocolPacket[] = [];
    for (let frame = this.takeFrame(); frame; frame = this.takeFrame())
      packets.push(...this.frame(frame));
    return packets;
  }

  /** C01 sets the outputs; output 1 drives the fuel or starter relay. */
  encodeCommand(command: ProtocolCommand): Buffer | undefined {
    if (!this.uniqueId) return undefined;
    if (command.type === 'engineStop') return this.command('C01,0,12222');
    if (command.type === 'engineResume') return this.command('C01,0,02222');
    const data = customCommandData(command);
    return command.type === 'custom' && data ? this.command(data) : undefined;
  }

  private command(content: string) {
    const length = 1 + this.uniqueId!.length + 1 + content.length + 5;
    const body = `@@A${String(length).padStart(2, '0')},${this.uniqueId},${content}*`;
    return Buffer.from(`${body}${checksum(body)}\r\n`, 'ascii');
  }

  /** The length after `$$<flag>` counts from the first comma to the end of the frame. */
  private takeFrame(): Buffer | undefined {
    const start = this.pending.indexOf('$$');
    if (start < 0) {
      this.pending = this.pending.subarray(Math.max(0, this.pending.length - 1));
      return undefined;
    }
    this.pending = this.pending.subarray(start);
    const comma = this.pending.indexOf(0x2c);
    if (comma < 0 || comma > 12) return comma > 12 ? this.skip() : undefined;
    const length = Number(this.pending.subarray(3, comma).toString('ascii'));
    if (!Number.isInteger(length) || length <= 0) return this.skip();
    if (this.pending.length < comma + length) return undefined;
    const frame = this.pending.subarray(0, comma + length);
    this.pending = this.pending.subarray(comma + length);
    return frame;
  }

  private skip() {
    this.pending = this.pending.subarray(2);
    return this.takeFrame();
  }

  private frame(frame: Buffer): ProtocolPacket[] {
    const sentence = frame.toString('ascii').trim();
    const body = sentence.slice(0, sentence.lastIndexOf('*'));
    const fields = body.split(',');
    const [, imei = '', type = ''] = fields;
    const packets: ProtocolPacket[] = [];
    if (!/^\d+$/.test(imei)) return packets;
    if (imei !== this.uniqueId) {
      this.uniqueId = imei;
      packets.push({ kind: 'identity', uniqueId: imei, acknowledgement: EMPTY });
    }
    if (type === 'AAC') {
      const reply = `@@z27,${imei},AAC,1*`;
      packets.push({
        kind: 'status',
        status: { attributes: {}, alarms: [] },
        acknowledgement: Buffer.from(`${reply}${checksum(reply)}\r\n`),
      });
    } else if (type === 'AAA' || type === 'AFF') {
      const position = decodePosition(fields, frame);
      if (position)
        packets.push({ kind: 'positions', positions: [position], acknowledgement: EMPTY });
    } else if (/^[A-Z]\d\d$/.test(type) && !['D00', 'D03'].includes(type)) {
      // A reply to a command, e.g. "C01,OK" or "D82,0".
      packets.push({ kind: 'commandResult', result: fields.slice(2).join(',') });
    }
    return packets;
  }
}

function decodePosition(fields: string[], frame: Buffer): DecodedPosition | undefined {
  // AFF messages carry an extra counter before the event code.
  const shift = fields[2] === 'AFF' ? 1 : 0;
  const at = (index: number) => fields[index + shift] ?? '';
  const event = Number(at(3));
  const latitude = Number(at(4));
  const longitude = Number(at(5));
  const time = at(6);
  if (!/^\d{12}$/.test(time) || !Number.isFinite(latitude) || !Number.isFinite(longitude))
    return undefined;
  const number = (index: number) => {
    const value = Number(at(index));
    return Number.isFinite(value) ? value : undefined;
  };
  // 16 is the cell tower (mcc|mnc|lac|cid).
  const io = at(17);
  const attributes: Record<string, number | string | boolean> = {
    event,
    satellites: number(8) ?? 0,
    rssi: number(9) ?? 0,
    hdop: number(12) ?? 0,
    odometer: number(14) ?? 0,
    runtime: at(15),
  };
  if (/^[0-9A-Fa-f]{4}$/.test(io)) {
    attributes.input = Number.parseInt(io.slice(0, 2), 16);
    attributes.output = Number.parseInt(io.slice(2, 4), 16);
  }
  const analog = at(18).split('|');
  if (analog.length >= 5) {
    if (analog[0]?.includes('.')) {
      // battery|power|rtc|mcu|gps, already in volts.
      attributes.batteryV = Number(analog[0]);
      attributes.powerV = Number(analog[1]);
    } else {
      // adc1|adc2|adc3|battery|power, battery and power in hundredths of a volt.
      for (let index = 0; index < 3; index += 1)
        if (analog[index]) attributes[`adc${index + 1}`] = Number.parseInt(analog[index]!, 16);
      if (analog[3]) attributes.batteryV = Number.parseInt(analog[3], 16) / 100;
      if (analog[4]) attributes.powerV = Number.parseInt(analog[4], 16) / 100;
    }
  }
  const alarm = ALARMS[event];
  return {
    messageId: stableMessageId('meitrack', frame),
    fixTime: Date.UTC(
      2000 + Number(time.slice(0, 2)),
      Number(time.slice(2, 4)) - 1,
      Number(time.slice(4, 6)),
      Number(time.slice(6, 8)),
      Number(time.slice(8, 10)),
      Number(time.slice(10, 12)),
    ),
    valid: at(7) === 'A',
    latitude,
    longitude,
    speedKmh: number(10) ?? 0,
    courseDeg: number(11) ?? 0,
    altitudeM: number(13) ?? 0,
    attributes,
    ...(alarm ? { alarms: [alarm] } : {}),
  };
}

/** Sum of the bytes, as two upper-case hex digits. */
function checksum(text: string) {
  let sum = 0;
  for (const byte of Buffer.from(text, 'ascii')) sum = (sum + byte) & 0xff;
  return sum.toString(16).toUpperCase().padStart(2, '0');
}

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

const EMERGENCIES: Record<number, string> = {
  1: 'sos',
  2: 'parking',
  3: 'powerCut',
  5: 'door',
  6: 'door',
  7: 'movement',
  8: 'vibration',
};
const ALERTS: Record<number, string> = {
  1: 'overspeed',
  5: 'geofenceExit',
  6: 'geofenceEnter',
  14: 'lowBattery',
  15: 'vibration',
  16: 'accident',
  40: 'powerRestored',
  41: 'powerCut',
  42: 'sos',
  46: 'hardAcceleration',
  47: 'hardBraking',
  50: 'jamming',
  132: 'door',
};
const REPORTS = new Set(['STT', 'EMG', 'EVT', 'ALT', 'UEX']);

/**
 * Suntech SA200 / ST300 / ST340 / ST500 / ST600 text reports: `ST300STT;<id>;...` separated by
 * semicolons, one report per line. Ported from the legacy server's Suntech decoder (this "legacy"
 * Suntech format; the newer universal and binary formats are not decoded).
 */
export class SuntechDecoder implements ProtocolDecoder {
  readonly protocol = 'suntech' as const;
  private pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private uniqueId?: string;
  private model = 'SA200';

  push(chunk: Buffer): ProtocolPacket[] {
    this.pending = concatPending(this.pending, chunk);
    const packets: ProtocolPacket[] = [];
    for (;;) {
      const end = this.pending.findIndex((byte) => byte === 0x0d || byte === 0x0a);
      if (end < 0) break;
      const line = this.pending.subarray(0, end).toString('ascii').trim();
      this.pending = this.pending.subarray(end + 1);
      if (line) packets.push(...this.line(line));
    }
    return packets;
  }

  /** Output 1 drives the relay; the command repeats the model prefix the tracker reports with. */
  encodeCommand(command: ProtocolCommand): Buffer | undefined {
    if (!this.uniqueId) return undefined;
    const action =
      { engineStop: 'Enable1', engineResume: 'Disable1' }[command.type] ??
      (command.type === 'custom' ? customCommandData(command) : undefined);
    return action ? Buffer.from(`${this.model}CMD;${this.uniqueId};02;${action}\r`) : undefined;
  }

  private line(line: string): ProtocolPacket[] {
    const values = line.split(';');
    const prefix = values[0] ?? '';
    const match = /^(S[AT]\d{3})([A-Z]{3})$/.exec(prefix);
    if (!match) return [];
    const [, model = '', type = ''] = match;
    this.model = model;
    const result = values[1] === 'Res';
    const id = values[result ? 2 : 1] ?? '';
    if (!/^\d+$/.test(id)) return [];
    const packets: ProtocolPacket[] = [];
    if (id !== this.uniqueId) {
      this.uniqueId = id;
      packets.push({ kind: 'identity', uniqueId: id, acknowledgement: EMPTY });
    }
    if (result) {
      packets.push({ kind: 'commandResult', result: values.slice(3).join(';') });
      return packets;
    }
    if (!REPORTS.has(type)) return packets;
    const position = decodeReport(model, type, values, line);
    if (position)
      packets.push({ kind: 'positions', positions: [position], acknowledgement: EMPTY });
    return packets;
  }
}

function decodeReport(
  model: string,
  type: string,
  values: string[],
  line: string,
): DecodedPosition | undefined {
  let index = 2;
  // ST3xx, ST500 and ST600 add a model field; SA200 does not.
  if (model.startsWith('ST3') || model === 'ST500' || model === 'ST600') index += 1;
  index += 1; // firmware
  const date = values[index++] ?? '';
  const time = values[index++] ?? '';
  if (model !== 'ST500') {
    index += 1; // cell id
    if (model === 'ST600') index += 4; // mcc, mnc, lac, rx level
  }
  const latitude = Number(values[index++]);
  const longitude = Number(values[index++]);
  const speedKmh = Number(values[index++]);
  const courseDeg = Number(values[index++]);
  const satellites = Number(values[index++]);
  const valid = values[index++] === '1';
  const odometer = Number(values[index++]);
  const powerV = Number(values[index++]);
  const io = values[index++] ?? '';
  if (
    !/^\d{8}$/.test(date) ||
    !/^\d{2}:\d{2}:\d{2}$/.test(time) ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  )
    return undefined;
  const attributes: Record<string, number | string | boolean> = {
    type,
    satellites,
    odometer,
    powerV,
  };
  if (io.length >= 6) {
    attributes.ignition = io[0] === '1';
    ['in1', 'in2', 'in3'].forEach((name, offset) => (attributes[name] = io[offset + 1] === '1'));
    attributes.out1 = io[4] === '1';
    attributes.out2 = io[5] === '1';
  }
  const code = Number(values[index]);
  let alarm: string | undefined;
  if (type === 'EMG') alarm = EMERGENCIES[code];
  if (type === 'ALT') alarm = ALERTS[code];
  if (type === 'EVT') attributes.event = code;
  return {
    messageId: stableMessageId('suntech', Buffer.from(line)),
    fixTime: Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(4, 6)) - 1,
      Number(date.slice(6, 8)),
      Number(time.slice(0, 2)),
      Number(time.slice(3, 5)),
      Number(time.slice(6, 8)),
    ),
    valid,
    latitude,
    longitude,
    speedKmh: Number.isFinite(speedKmh) ? speedKmh : 0,
    courseDeg: Number.isFinite(courseDeg) ? courseDeg : 0,
    attributes,
    ...(alarm ? { alarms: [alarm] } : {}),
  };
}

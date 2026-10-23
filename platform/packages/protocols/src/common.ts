import type { TrackerProtocol } from './ports';
import { createHash } from 'node:crypto';

export interface DecodedPosition {
  messageId: string;
  fixTime: number;
  valid: boolean;
  latitude: number;
  longitude: number;
  altitudeM?: number;
  speedKmh?: number;
  courseDeg?: number;
  attributes: Record<string, number | string | boolean>;
  /** Alarm names from @trackify/domain's alarm list. */
  alarms?: string[];
}

/** Device state without a location fix, e.g. a GT06 heartbeat. */
export interface DecodedStatus {
  attributes: Record<string, number | string | boolean>;
  alarms: string[];
}

export type ProtocolPacket =
  | { kind: 'identity'; uniqueId: string; acknowledgement: Buffer }
  | { kind: 'positions'; positions: DecodedPosition[]; acknowledgement: Buffer }
  | { kind: 'status'; status: DecodedStatus; acknowledgement: Buffer }
  /** A device's reply to a command; `correlation` is set when the protocol echoes it back. */
  | { kind: 'commandResult'; result: string; correlation?: number; acknowledgement?: Buffer };

/** Commands the platform can send. `custom` carries protocol text (or hex) in payload.data. */
export interface ProtocolCommand {
  type: string;
  payload: Record<string, unknown>;
}

export interface ProtocolDecoder {
  readonly protocol: TrackerProtocol;
  push(chunk: Buffer): ProtocolPacket[];
  /**
   * Bytes to write to the device, or undefined when the protocol has no encoding for the command.
   * `correlation` is echoed back in the reply by protocols that support it.
   */
  encodeCommand(command: ProtocolCommand, correlation: number): Buffer | undefined;
}

export function customCommandData(command: ProtocolCommand): string | undefined {
  const data = command.payload.data;
  return typeof data === 'string' && data.length > 0 ? data : undefined;
}

export function stableMessageId(protocol: string, frame: Buffer, index = 0): string {
  return `${protocol}:${createHash('sha256').update(frame).update(String(index)).digest('hex')}`;
}

export function concatPending(pending: Buffer, chunk: Buffer, maxBytes = 1024 * 1024): Buffer {
  const result = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
  if (result.length > maxBytes) throw new Error(`protocol buffer exceeded ${maxBytes} bytes`);
  return result;
}

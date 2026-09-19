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
}

export type ProtocolPacket =
  | { kind: 'identity'; uniqueId: string; acknowledgement: Buffer }
  | { kind: 'positions'; positions: DecodedPosition[]; acknowledgement: Buffer };

export interface ProtocolDecoder {
  readonly protocol: 'gt06' | 'teltonika';
  push(chunk: Buffer): ProtocolPacket[];
}

export function stableMessageId(protocol: string, frame: Buffer, index = 0): string {
  return `${protocol}:${createHash('sha256').update(frame).update(String(index)).digest('hex')}`;
}

export function concatPending(pending: Buffer, chunk: Buffer, maxBytes = 1024 * 1024): Buffer {
  const result = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
  if (result.length > maxBytes) throw new Error(`protocol buffer exceeded ${maxBytes} bytes`);
  return result;
}

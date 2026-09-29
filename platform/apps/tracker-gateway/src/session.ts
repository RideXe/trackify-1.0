import type { Socket } from 'node:net';
import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import type { DeviceDirectory, DeviceIdentity } from '@trackify/data';
import { parsePositionMessage, type PositionMessage } from '@trackify/domain';
import type { DecodedPosition, ProtocolDecoder } from '@trackify/protocols';
import { ulid } from 'ulid';

export interface QueueWriter {
  send(position: PositionMessage): Promise<void>;
}

export class SqsQueueWriter implements QueueWriter {
  constructor(
    private readonly client: SQSClient,
    private readonly queueUrl: string,
  ) {}
  async send(position: PositionMessage): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(position),
        MessageGroupId: `${position.tenantId}:${position.deviceId}`,
        MessageDeduplicationId: position.messageId,
      }),
    );
  }
}

export class GatewaySession {
  private device?: DeviceIdentity;
  private processing = Promise.resolve();

  constructor(
    private readonly socket: Pick<Socket, 'write' | 'destroy'>,
    private readonly decoder: ProtocolDecoder,
    private readonly devices: DeviceDirectory,
    private readonly queue: QueueWriter,
    private readonly now: () => number = Date.now,
  ) {}

  receive(chunk: Buffer): void {
    this.processing = this.processing
      .then(() => this.process(chunk))
      .catch((error: unknown) => {
        console.error('gateway session failed', { protocol: this.decoder.protocol, error });
        this.socket.destroy();
      });
  }

  settled(): Promise<void> {
    return this.processing;
  }

  private async process(chunk: Buffer): Promise<void> {
    for (const packet of this.decoder.push(chunk)) {
      if (packet.kind === 'identity') {
        const device = await this.devices.resolve(packet.uniqueId);
        if (!device || device.protocol !== this.decoder.protocol) throw new Error('unknown device');
        this.device = device;
        this.socket.write(packet.acknowledgement);
        continue;
      }
      if (!this.device) throw new Error('position received before identity');
      for (const decoded of packet.positions) {
        const position = normalize(decoded, this.device, this.decoder.protocol, this.now());
        await this.queue.send(position);
      }
      this.socket.write(packet.acknowledgement);
    }
  }
}

function normalize(
  decoded: DecodedPosition,
  device: DeviceIdentity,
  protocol: 'gt06' | 'teltonika',
  receivedAt: number,
): PositionMessage {
  const { satellites, ignition, motion, ...io } = decoded.attributes;
  const satelliteCount = typeof satellites === 'number' ? satellites : undefined;
  const parsed = parsePositionMessage({
    v: 1,
    ingestId: ulid(receivedAt),
    messageId: decoded.messageId,
    tenantId: device.tenantId,
    deviceId: device.deviceId,
    uniqueId: device.uniqueId,
    protocol,
    source: 'gateway',
    retentionDays: device.retentionDays,
    receivedAt,
    fixTime: decoded.fixTime,
    valid: decoded.valid,
    latitude: decoded.latitude,
    longitude: decoded.longitude,
    altitudeM: decoded.altitudeM,
    speedKmh: decoded.speedKmh,
    courseDeg: decoded.courseDeg,
    accuracyM: estimateAccuracyFromSatellites(satelliteCount),
    attributes: {
      satellites: satelliteCount,
      ignition: typeof ignition === 'boolean' ? ignition : undefined,
      motion: typeof motion === 'boolean' ? motion : undefined,
      io,
    },
  });
  if (!parsed.success)
    throw new Error(`decoder produced invalid position: ${parsed.error.message}`);
  return parsed.data;
}

/**
 * GT06 and Teltonika trackers report how many satellites they can see but not real HDOP, so the
 * server-side drift filter (packages/geo movedBeyondDrift) has nothing to work with and falls back
 * to a flat minimum for every fix. Fewer visible satellites means a worse position fix, so this
 * gives a rough accuracy figure from satellite count instead — the same fallback technique other
 * GPS tracking backends use when a protocol has no real accuracy field. Bands are deliberately
 * conservative (biased toward "less accurate") so real drift is never under-filtered.
 */
export function estimateAccuracyFromSatellites(satellites: number | undefined): number | undefined {
  if (satellites === undefined || satellites <= 0) return undefined;
  if (satellites <= 4) return 50;
  if (satellites <= 5) return 30;
  if (satellites <= 6) return 20;
  if (satellites <= 7) return 15;
  if (satellites <= 8) return 10;
  return 6;
}

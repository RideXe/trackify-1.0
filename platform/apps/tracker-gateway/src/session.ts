import type { Socket } from 'node:net';
import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import type { DeviceDirectory, DeviceIdentity, PendingCommand } from '@trackify/data';
import { alarmTypeSchema, parsePositionMessage, type PositionMessage } from '@trackify/domain';
import type {
  DecodedPosition,
  DecodedStatus,
  ProtocolDecoder,
  TrackerProtocol,
} from '@trackify/protocols';
import { ulid } from 'ulid';

export interface QueueWriter {
  send(position: PositionMessage): Promise<void>;
}

/** Where command replies go: the command record and a commandResult event. */
export interface CommandResults {
  delivered(
    device: DeviceIdentity,
    command: PendingCommand | undefined,
    result: string,
  ): Promise<void>;
}

/** Connected devices of this gateway task, so the command dispatcher can reach them. */
export type SessionRegistry = Map<string, GatewaySession>;

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

/** Commands written to the device and not yet answered, oldest first. */
interface Outstanding {
  command: PendingCommand;
  correlation: number;
  sentAt: number;
}

const OUTSTANDING_LIMIT = 20;
const OUTSTANDING_MAX_AGE_MS = 15 * 60_000;

export class GatewaySession {
  private device?: DeviceIdentity;
  private processing = Promise.resolve();
  private last?: PositionMessage;
  private outstanding: Outstanding[] = [];
  private nextCorrelation = 1;

  constructor(
    private readonly socket: Pick<Socket, 'write' | 'destroy'>,
    private readonly decoder: ProtocolDecoder,
    private readonly devices: DeviceDirectory,
    private readonly queue: QueueWriter,
    private readonly now: () => number = Date.now,
    private readonly registry?: SessionRegistry,
    private readonly results?: CommandResults,
  ) {}

  get deviceId(): string | undefined {
    return this.device?.deviceId;
  }

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

  /** Called when the socket closes, so commands are not routed to a dead connection. */
  close(): void {
    if (this.device && this.registry?.get(this.device.deviceId) === this) {
      this.registry.delete(this.device.deviceId);
    }
  }

  /**
   * Writes a command to the device. Returns false when this protocol cannot encode it; the caller
   * records that as a failure instead of leaving the command waiting forever.
   */
  deliver(command: PendingCommand): { sent: boolean; correlation: number } {
    const correlation = this.nextCorrelation++ >>> 0;
    const bytes = this.decoder.encodeCommand(command, correlation);
    if (!bytes) return { sent: false, correlation };
    this.socket.write(bytes);
    this.outstanding.push({ command, correlation, sentAt: this.now() });
    this.outstanding = this.outstanding
      .filter((item) => this.now() - item.sentAt < OUTSTANDING_MAX_AGE_MS)
      .slice(-OUTSTANDING_LIMIT);
    return { sent: true, correlation };
  }

  private async process(chunk: Buffer): Promise<void> {
    for (const packet of this.decoder.push(chunk)) {
      if (packet.kind === 'identity') {
        const device = await this.devices.resolve(packet.uniqueId);
        if (!device || device.protocol !== this.decoder.protocol) throw new Error('unknown device');
        this.device = device;
        this.registry?.set(device.deviceId, this);
        this.acknowledge(packet.acknowledgement);
        continue;
      }
      if (!this.device) throw new Error(`${packet.kind} received before identity`);
      if (packet.kind === 'positions') {
        for (const decoded of packet.positions) {
          const position = normalize(decoded, this.device, this.decoder.protocol, this.now());
          await this.queue.send(position);
          this.last = position;
        }
        this.acknowledge(packet.acknowledgement);
      } else if (packet.kind === 'status') {
        await this.status(packet.status);
        this.acknowledge(packet.acknowledgement);
      } else {
        await this.reply(packet.result, packet.correlation);
        this.acknowledge(packet.acknowledgement);
      }
    }
  }

  /** Some protocols expect no reply to some messages; their acknowledgement is empty. */
  private acknowledge(bytes: Buffer | undefined) {
    if (bytes?.length) this.socket.write(bytes);
  }

  /**
   * A heartbeat carries no fix. Alarms and ignition changes in it still matter (SOS, power cut), so
   * like the legacy server they are reported at the last known location; plain heartbeats are not.
   */
  private async status(status: DecodedStatus) {
    const alarms = knownAlarms(status.alarms);
    const ignition =
      typeof status.attributes.ignition === 'boolean' ? status.attributes.ignition : undefined;
    const ignitionChanged = ignition !== undefined && ignition !== this.last?.attributes.ignition;
    if (!this.last || (!alarms.length && !ignitionChanged)) return;
    const receivedAt = this.now();
    const position: PositionMessage = {
      ...this.last,
      ingestId: ulid(receivedAt),
      // Unique per report: FIFO de-duplication would drop a second one with the same id.
      messageId: `${this.decoder.protocol}:status:${ulid(receivedAt)}`,
      receivedAt,
      fixTime: Math.max(receivedAt, this.last.fixTime + 1),
      speedKmh: 0,
      attributes: {
        ...this.last.attributes,
        ...(ignition === undefined ? {} : { ignition }),
        alarms: alarms.length ? alarms : undefined,
      },
    };
    await this.queue.send(position);
    this.last = position;
  }

  /** Pairs a reply with its command: by echoed correlation when the protocol has one, else oldest. */
  private async reply(result: string, correlation: number | undefined) {
    // Some GT06 models announce their SIM unprompted; that is not an answer to anything.
    if (result.startsWith('<ICCID:')) return;
    const index =
      correlation !== undefined && correlation !== 0
        ? this.outstanding.findIndex((item) => item.correlation === correlation)
        : 0;
    const [match] = index >= 0 ? this.outstanding.splice(index, 1) : [];
    await this.results?.delivered(this.device!, match?.command, result);
  }
}

function knownAlarms(alarms: string[] | undefined) {
  return (alarms ?? []).filter((alarm) => alarmTypeSchema.safeParse(alarm).success) as NonNullable<
    PositionMessage['attributes']['alarms']
  >;
}

function normalize(
  decoded: DecodedPosition,
  device: DeviceIdentity,
  protocol: TrackerProtocol,
  receivedAt: number,
): PositionMessage {
  const { satellites, ignition, motion, batteryLevel, rssi, charge, ...io } = decoded.attributes;
  const satelliteCount = typeof satellites === 'number' ? satellites : undefined;
  const alarms = knownAlarms(decoded.alarms);
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
      batteryLevelPct: typeof batteryLevel === 'number' ? batteryLevel : undefined,
      rssi: typeof rssi === 'number' ? rssi : undefined,
      charging: typeof charge === 'boolean' ? charge : undefined,
      alarms: alarms.length ? alarms : undefined,
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

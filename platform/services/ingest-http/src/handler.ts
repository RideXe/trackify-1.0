import { createHash } from 'node:crypto';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { SQSClient, SendMessageBatchCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import {
  createDocumentClient,
  DynamoOnboardingStore,
  DynamoPresenceStore,
  type OnboardingInvitation,
} from '@trackify/data';
import { motionActivitySchema, parsePositionMessage, type PositionMessage } from '@trackify/domain';
import { ulid } from 'ulid';

interface QueueWriter {
  send(position: PositionMessage): Promise<void>;
  /** In order; FIFO keeps one vehicle's positions sequential. */
  sendAll(positions: PositionMessage[]): Promise<void>;
}

/** The most points one batch may carry: a 5-minute window at one point per second. */
const MAX_BATCH_POINTS = 300;

interface Dependencies {
  credentials: {
    resolveCredential(credentialHash: string): Promise<OnboardingInvitation | undefined>;
  };
  queue: QueueWriter;
  /** Records a phone's check-in when a window had no usable position (indoors, weak GPS). */
  presence?: {
    markSeen(
      tenantId: string,
      deviceId: string,
      seenAt: number,
      syncIntervalSeconds?: number,
    ): Promise<boolean>;
  };
  now: () => number;
}

export function createHandler(deps: Dependencies) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    try {
      const token = bearerToken(event.headers.authorization ?? event.headers.Authorization);
      if (!token) return response(401, 'device credential required');
      const device = await deps.credentials.resolveCredential(hash(token));
      if (!device) return response(401, 'invalid device credential');
      const batch = parseBatch(event);
      if (batch) return await acceptBatch(batch, device, deps);
      const input = parseInput(event);
      const uniqueId = device.uniqueId;
      if (input.id && input.id !== uniqueId) return response(403, 'device credential mismatch');
      const receivedAt = deps.now();
      const raw = canonicalInput(input);
      const candidate = {
        v: 1,
        ingestId: ulid(receivedAt),
        messageId: `http:${createHash('sha256').update(uniqueId).update(raw).digest('hex')}`,
        tenantId: device.tenantId,
        deviceId: device.deviceId,
        uniqueId,
        protocol: 'osmand',
        source: 'http',
        retentionDays: device.retentionDays,
        receivedAt,
        fixTime: parseTimestamp(input.timestamp, receivedAt),
        valid: input.valid !== 'false',
        latitude: numberValue(input, 'lat', -90, 90),
        longitude: numberValue(input, 'lon', -180, 180),
        altitudeM: optionalNumber(input.altitude),
        speedKmh:
          optionalNumber(input.speed) === undefined ? undefined : Number(input.speed) * 1.852,
        courseDeg: optionalNumber(input.bearing),
        accuracyM: optionalNumber(input.accuracy),
        attributes: {
          batteryLevelPct: optionalNumber(input.batt),
          charging: input.charge === undefined ? undefined : input.charge === 'true',
          alarms: input.alarm ? [input.alarm] : undefined,
        },
      };
      const parsed = parsePositionMessage(candidate);
      if (!parsed.success) return response(400, 'invalid position');
      await deps.queue.send(parsed.data);
      return response(202, 'accepted');
    } catch (error) {
      if (error instanceof InputError) {
        console.warn('phone upload refused', { reason: error.message });
        return response(400, error.message);
      }
      console.error('phone ingest failed', error);
      return response(503, 'temporarily unavailable');
    }
  };
}

interface BatchPoint {
  t: number;
  lat: number;
  lon: number;
  acc?: number;
  spd?: number;
  brg?: number;
  alt?: number;
  still?: boolean;
  act?: string;
  path?: number;
}

interface Batch {
  id?: string;
  batt?: number;
  /** The phone's sync interval, seconds. */
  int?: number;
  points: unknown[];
  filter?: Record<string, unknown>;
}

/** Format v2: one filtered window from the phone app (see apps/mobile/src/services/upload.ts). */
function parseBatch(event: APIGatewayProxyEventV2): Batch | undefined {
  if (!event.body || !(event.headers['content-type'] ?? '').includes('application/json'))
    return undefined;
  const body = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new InputError('request body must be JSON');
  }
  if (typeof value !== 'object' || value === null || (value as { v?: unknown }).v !== 2)
    return undefined;
  const batch = value as Batch;
  if (!Array.isArray(batch.points)) throw new InputError('points must be a list');
  if (batch.points.length > MAX_BATCH_POINTS)
    throw new InputError(`at most ${MAX_BATCH_POINTS} points per batch`);
  return batch;
}

async function acceptBatch(batch: Batch, device: OnboardingInvitation, deps: Dependencies) {
  if (batch.id !== undefined && batch.id !== device.uniqueId)
    return response(403, 'device credential mismatch');
  const receivedAt = deps.now();
  const interval =
    Number.isInteger(batch.int) && batch.int! >= 1 && batch.int! <= 3_600 ? batch.int : undefined;
  const positions: PositionMessage[] = [];
  let skipped = 0;
  batch.points.forEach((value, index) => {
    const point = value as BatchPoint;
    const last = index === batch.points.length - 1;
    const parsed = parsePositionMessage({
      v: 1,
      ingestId: ulid(receivedAt),
      // Same point re-sent after a retry gets the same id, so the queue drops the duplicate.
      messageId: `http:${createHash('sha256').update(`${device.uniqueId}|${point?.t}|${point?.lat}|${point?.lon}`).digest('hex')}`,
      tenantId: device.tenantId,
      deviceId: device.deviceId,
      uniqueId: device.uniqueId,
      protocol: 'osmand',
      source: 'http',
      retentionDays: device.retentionDays,
      receivedAt,
      fixTime: point?.t,
      valid: true,
      latitude: point?.lat,
      longitude: point?.lon,
      altitudeM: point?.alt,
      speedKmh: typeof point?.spd === 'number' ? point.spd * 3.6 : undefined,
      courseDeg: point?.brg,
      accuracyM: point?.acc,
      attributes: {
        // The phone already decided parked vs moving from its full-rate track.
        motion: typeof point?.still === 'boolean' ? !point.still : undefined,
        pathDistanceM: typeof point?.path === 'number' && point.path >= 0 ? point.path : undefined,
        syncIntervalS: interval,
        // An unknown value from a newer app is dropped rather than losing the point.
        activity: motionActivitySchema.safeParse(point?.act).data,
        batteryLevelPct: last && typeof batch.batt === 'number' ? batch.batt : undefined,
        io: last ? filterSummary(batch.filter) : undefined,
      },
    });
    if (parsed.success) positions.push(parsed.data);
    else skipped += 1;
  });
  positions.sort((a, b) => a.fixTime - b.fixTime);
  if (positions.length) await deps.queue.sendAll(positions);
  // No usable fix this window: the phone is still working, so it must not look offline.
  else await deps.presence?.markSeen(device.tenantId, device.deviceId, receivedAt, interval);
  // What the phone dropped and why: searchable in the logs when a driver reports a bad track.
  const rejected = batch.filter?.rejected;
  if (skipped || (rejected && Object.keys(rejected).length))
    console.info('phone batch', {
      deviceId: device.deviceId,
      accepted: positions.length,
      skipped,
      filter: batch.filter,
    });
  return {
    statusCode: 202,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accepted: positions.length, skipped }),
  };
}

/** The phone filter's counts, kept on the window's last point so history shows them. */
function filterSummary(filter: Record<string, unknown> | undefined) {
  if (!filter) return undefined;
  const summary: Record<string, number> = {};
  for (const key of ['raw', 'kept', 'uploaded', 'relocations', 'distanceM'] as const)
    if (typeof filter[key] === 'number') summary[`filter.${key}`] = filter[key];
  const rejected = filter.rejected;
  if (typeof rejected === 'object' && rejected !== null)
    for (const [reason, count] of Object.entries(rejected))
      if (typeof count === 'number' && /^[a-zA-Z]{1,24}$/.test(reason))
        summary[`filter.rejected.${reason}`] = count;
  return Object.keys(summary).length ? summary : undefined;
}

class SqsQueueWriter implements QueueWriter {
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
  async sendAll(positions: PositionMessage[]): Promise<void> {
    // Sequential groups of ten keep the order SQS FIFO then preserves per vehicle.
    for (let index = 0; index < positions.length; index += 10) {
      const group = positions.slice(index, index + 10);
      const result = await this.client.send(
        new SendMessageBatchCommand({
          QueueUrl: this.queueUrl,
          Entries: group.map((position, offset) => ({
            Id: String(offset),
            MessageBody: JSON.stringify(position),
            MessageGroupId: `${position.tenantId}:${position.deviceId}`,
            MessageDeduplicationId: position.messageId,
          })),
        }),
      );
      if (result.Failed?.length)
        throw new Error(`queue rejected ${result.Failed.length} positions`);
    }
  }
}

function dependenciesFromEnvironment(): Dependencies {
  const onboardingTable = requiredEnv('ONBOARDING_TABLE');
  const queueUrl = requiredEnv('INGEST_QUEUE_URL');
  const client = createDocumentClient();
  return {
    credentials: new DynamoOnboardingStore(client, onboardingTable),
    queue: new SqsQueueWriter(new SQSClient({}), queueUrl),
    presence: new DynamoPresenceStore(client, requiredEnv('DEVICE_STATE_TABLE')),
    now: Date.now,
  };
}

function bearerToken(value: string | undefined) {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export const handler = createHandler(dependenciesFromEnvironment());

function parseInput(event: APIGatewayProxyEventV2): Record<string, string | undefined> {
  const query = { ...(event.queryStringParameters ?? {}) };
  if (!event.body) return query;
  const body = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  const contentType = event.headers['content-type'] ?? '';
  if (contentType.includes('application/json')) {
    const parsedBody = JSON.parse(body) as Record<string, unknown>;
    return {
      ...query,
      ...Object.fromEntries(
        Object.entries(parsedBody)
          .filter(([, v]) => v != null)
          .map(([k, v]) => [k, String(v)]),
      ),
    };
  }
  return { ...query, ...Object.fromEntries(new URLSearchParams(body)) };
}

function canonicalInput(input: Record<string, string | undefined>): string {
  return Object.entries(input)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

function parseTimestamp(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new InputError('timestamp must be numeric');
  return numeric < 10_000_000_000 ? Math.round(numeric * 1000) : Math.round(numeric);
}

function numberValue(
  input: Record<string, string | undefined>,
  key: string,
  min: number,
  max: number,
) {
  const value = Number(required(input, key));
  if (!Number.isFinite(value) || value < min || value > max)
    throw new InputError(`${key} is invalid`);
  return value;
}

function optionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new InputError('numeric value is invalid');
  return parsed;
}

function required(input: Record<string, string | undefined>, key: string): string {
  const value = input[key];
  if (!value) throw new InputError(`${key} is required`);
  return value;
}

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}

class InputError extends Error {}

function response(statusCode: number, message: string): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message }),
  };
}

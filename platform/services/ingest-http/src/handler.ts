import { createHash } from 'node:crypto';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { createDocumentClient, DynamoDeviceDirectory, type DeviceDirectory } from '@trackify/data';
import { parsePositionMessage, type PositionMessage } from '@trackify/domain';
import { ulid } from 'ulid';

interface QueueWriter {
  send(position: PositionMessage): Promise<void>;
}

interface Dependencies {
  devices: DeviceDirectory;
  queue: QueueWriter;
  now: () => number;
}

export function createHandler(deps: Dependencies) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    try {
      const input = parseInput(event);
      const uniqueId = required(input, 'id');
      const device = await deps.devices.resolve(uniqueId);
      if (!device || device.protocol !== 'osmand') return response(404, 'unknown device');
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
      if (error instanceof InputError) return response(400, error.message);
      console.error('phone ingest failed', error);
      return response(503, 'temporarily unavailable');
    }
  };
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
}

function dependenciesFromEnvironment(): Dependencies {
  const coreTable = requiredEnv('CORE_TABLE');
  const queueUrl = requiredEnv('INGEST_QUEUE_URL');
  return {
    devices: new DynamoDeviceDirectory(createDocumentClient(), coreTable),
    queue: new SqsQueueWriter(new SQSClient({}), queueUrl),
    now: Date.now,
  };
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
      ...Object.fromEntries(Object.entries(parsedBody).map(([k, v]) => [k, String(v)])),
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

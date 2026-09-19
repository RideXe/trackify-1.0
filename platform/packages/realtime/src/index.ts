import { createHash, createHmac } from 'node:crypto';
import type { PositionMessage } from '@trackify/domain';

export interface PositionPublisher {
  publish(position: PositionMessage): Promise<void>;
}

export class AppSyncPositionPublisher implements PositionPublisher {
  constructor(
    private readonly httpDns: string,
    private readonly region: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async publish(position: PositionMessage): Promise<void> {
    const request = signedPublishRequest(
      this.httpDns,
      this.region,
      `/fleet/${position.tenantId}`,
      position,
      credentialsFromEnvironment(),
      new Date(),
    );
    const result = await this.fetcher(request);
    if (!result.ok) throw new Error(`realtime publish failed: ${result.status}`);
  }
}

interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export function signedPublishRequest(
  httpDns: string,
  region: string,
  channel: string,
  event: unknown,
  credentials: Credentials,
  now: Date,
): Request {
  const body = JSON.stringify({ channel, events: [JSON.stringify(event)] });
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    host: httpDns,
    'x-amz-date': amzDate,
  };
  if (credentials.sessionToken) headers['x-amz-security-token'] = credentials.sessionToken;
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((key) => `${key}:${headers[key]?.trim()}\n`)
    .join('');
  const canonicalRequest = ['POST', '/event', '', canonicalHeaders, signedHeaders, hash(body)].join(
    '\n',
  );
  const scope = `${date}/${region}/appsync/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, hash(canonicalRequest)].join('\n');
  const dateKey = createHmac('sha256', `AWS4${credentials.secretAccessKey}`).update(date).digest();
  const regionKey = createHmac('sha256', dateKey).update(region).digest();
  const serviceKey = createHmac('sha256', regionKey).update('appsync').digest();
  const signingKey = createHmac('sha256', serviceKey).update('aws4_request').digest();
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return new Request(`https://${httpDns}/event`, { method: 'POST', headers, body });
}

function credentialsFromEnvironment(): Credentials {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) throw new Error('AWS runtime credentials are unavailable');
  return { accessKeyId, secretAccessKey, sessionToken: process.env.AWS_SESSION_TOKEN };
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

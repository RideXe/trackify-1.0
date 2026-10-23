import { createHash, randomBytes } from 'node:crypto';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { createDocumentClient, DynamoOnboardingStore } from '@trackify/data';

interface OnboardingStore {
  redeem(
    codeHash: string,
    credentialHash: string,
    now: number,
  ): Promise<
    | {
        deviceId: string;
        deviceName: string;
        uniqueId: string;
        retentionDays: number;
      }
    | undefined
  >;
}

export function createHandler(
  store: OnboardingStore,
  apiBaseUrl: string,
  now: () => number = Date.now,
  credential: () => string = () => randomBytes(32).toString('base64url'),
) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    try {
      if (event.requestContext.http.method !== 'POST') return response(405, 'method not allowed');
      const match = event.rawPath.match(/^\/onboard\/([^/]+)\/redeem$/);
      if (!match?.[1]) return response(404, 'route not found');
      const code = normalizeCode(match[1]);
      if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) return response(400, 'invalid setup code');
      const deviceCredential = credential();
      const invitation = await store.redeem(hash(code), hash(deviceCredential), now());
      if (!invitation) return response(410, 'setup code is expired, used, or revoked');
      return json(200, {
        deviceId: invitation.deviceId,
        uniqueId: invitation.uniqueId,
        name: invitation.deviceName,
        endpoint: `${apiBaseUrl.replace(/\/$/, '')}/phone/positions`,
        credential: deviceCredential,
      });
    } catch (error) {
      console.error('onboarding redemption failed', error);
      return response(503, 'temporarily unavailable');
    }
  };
}

const client = createDocumentClient();
export const handler = createHandler(
  new DynamoOnboardingStore(client, requiredEnv('ONBOARDING_TABLE')),
  requiredEnv('API_BASE_URL'),
);

function normalizeCode(value: string) {
  return decodeURIComponent(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function requiredEnv(key: string) {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function response(statusCode: number, message: string) {
  return json(statusCode, { message });
}

function json(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

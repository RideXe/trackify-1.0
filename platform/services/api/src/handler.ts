import { createHash, randomInt } from 'node:crypto';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import {
  createDocumentClient,
  DynamoFleetStore,
  DynamoOnboardingStore,
  type Membership,
  type OnboardingInvitation,
} from '@trackify/data';

interface FleetStore {
  membership(subject: string): Promise<Membership | undefined>;
  listDevices(tenantId: string): Promise<unknown[]>;
  createDevice(tenantId: string, input: DeviceInput): Promise<unknown>;
  getDevice(
    tenantId: string,
    deviceId: string,
  ): Promise<
    | { deviceId: string; name: string; uniqueId: string; protocol: string; retentionDays: number }
    | undefined
  >;
  positions(
    tenantId: string,
    deviceId: string,
    from: number,
    to: number,
    limit: number,
  ): Promise<unknown[] | undefined>;
  events(
    tenantId: string,
    deviceId: string,
    from: number,
    to: number,
    limit: number,
  ): Promise<unknown[] | undefined>;
  trips(
    tenantId: string,
    deviceId: string,
    from: number,
    to: number,
    limit: number,
  ): Promise<unknown[] | undefined>;
  dailyStats(
    tenantId: string,
    deviceId: string,
    fromDay: string,
    toDay: string,
  ): Promise<unknown[] | undefined>;
  createCommand(
    tenantId: string,
    deviceId: string,
    requestedBy: string,
    type: string,
    payload: Record<string, unknown>,
    expiresAtMs: number,
  ): Promise<Record<string, unknown> | undefined>;
}

interface InvitationStore {
  create(invitation: OnboardingInvitation): Promise<OnboardingInvitation>;
  list(tenantId: string, deviceId: string): Promise<OnboardingInvitation[]>;
  revoke(tenantId: string, codeHash: string): Promise<boolean>;
}

interface DeviceInput {
  name: string;
  uniqueId: string;
  protocol: string;
  retentionDays: number;
  groupId: string;
}

export function createHandler(
  store: FleetStore,
  invitations?: InvitationStore,
  onboardingWebUrl = 'https://trackify.invalid',
) {
  return async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
    try {
      const subject = event.requestContext.authorizer.jwt.claims.sub;
      if (typeof subject !== 'string') return response(401, { message: 'invalid identity' });
      const membership = await store.membership(subject);
      if (!membership) return response(403, { message: 'fleet membership required' });
      const method = event.requestContext.http.method;
      const path = event.rawPath;

      if (method === 'GET' && path === '/me') return response(200, membership);
      if (method === 'GET' && path === '/devices') {
        return response(200, { items: await store.listDevices(membership.tenantId) });
      }
      if (method === 'POST' && path === '/devices') {
        if (membership.role !== 'admin') return response(403, { message: 'admin role required' });
        const input = parseDevice(event.body);
        const device = await store.createDevice(membership.tenantId, input);
        if (input.protocol !== 'osmand' || !invitations) return response(201, device);
        const onboarding = await createInvitation(
          invitations,
          membership.tenantId,
          device as { deviceId: string; name: string; uniqueId: string; retentionDays: number },
          onboardingWebUrl,
        );
        return response(201, { ...(device as object), onboarding });
      }
      const invitationMatch = path.match(/^\/devices\/([^/]+)\/invitations$/);
      if (invitationMatch?.[1] && method === 'GET') {
        if (!invitations) return response(503, { message: 'onboarding unavailable' });
        const device = await store.getDevice(membership.tenantId, invitationMatch[1]);
        if (!device) return response(404, { message: 'device not found' });
        const items = await invitations.list(membership.tenantId, device.deviceId);
        return response(200, { items: items.map(publicInvitation) });
      }
      if (invitationMatch?.[1] && method === 'POST') {
        if (membership.role !== 'admin') return response(403, { message: 'admin role required' });
        if (!invitations) return response(503, { message: 'onboarding unavailable' });
        const device = await store.getDevice(membership.tenantId, invitationMatch[1]);
        if (!device) return response(404, { message: 'device not found' });
        return response(
          201,
          await createInvitation(invitations, membership.tenantId, device, onboardingWebUrl),
        );
      }
      const revokeMatch = path.match(/^\/invitations\/([a-f0-9]{64})$/);
      if (revokeMatch?.[1] && method === 'DELETE') {
        if (membership.role !== 'admin') return response(403, { message: 'admin role required' });
        if (!invitations) return response(503, { message: 'onboarding unavailable' });
        const revoked = await invitations.revoke(membership.tenantId, revokeMatch[1]);
        return revoked ? response(204, undefined) : response(404, { message: 'invite not found' });
      }
      const match = path.match(/^\/devices\/([^/]+)\/positions$/);
      if (method === 'GET' && match?.[1]) {
        const now = Date.now();
        const from = boundedNumber(event.queryStringParameters?.from, now - 86_400_000, 0, now);
        const to = boundedNumber(event.queryStringParameters?.to, now, from, now + 300_000);
        const limit = boundedNumber(event.queryStringParameters?.limit, 1_000, 1, 5_000);
        const items = await store.positions(membership.tenantId, match[1], from, to, limit);
        return items ? response(200, { items }) : response(404, { message: 'device not found' });
      }
      const reportMatch = path.match(/^\/devices\/([^/]+)\/(events|trips)$/);
      if (method === 'GET' && reportMatch?.[1] && reportMatch[2]) {
        const now = Date.now();
        const from = boundedNumber(event.queryStringParameters?.from, now - 86_400_000, 0, now);
        const to = boundedNumber(event.queryStringParameters?.to, now, from, now + 300_000);
        const limit = boundedNumber(event.queryStringParameters?.limit, 1_000, 1, 5_000);
        const items =
          reportMatch[2] === 'events'
            ? await store.events(membership.tenantId, reportMatch[1], from, to, limit)
            : await store.trips(membership.tenantId, reportMatch[1], from, to, limit);
        return items ? response(200, { items }) : response(404, { message: 'device not found' });
      }
      const summaryMatch = path.match(/^\/devices\/([^/]+)\/summary$/);
      if (method === 'GET' && summaryMatch?.[1]) {
        const today = new Date().toISOString().slice(0, 10);
        const from = day(event.queryStringParameters?.from ?? today);
        const to = day(event.queryStringParameters?.to ?? today);
        const items = await store.dailyStats(membership.tenantId, summaryMatch[1], from, to);
        return items ? response(200, { items }) : response(404, { message: 'device not found' });
      }
      const commandMatch = path.match(/^\/devices\/([^/]+)\/commands$/);
      if (method === 'POST' && commandMatch?.[1]) {
        if (membership.role === 'viewer')
          return response(403, { message: 'command permission required' });
        const command = parseCommand(event.body, membership.role);
        const created = await store.createCommand(
          membership.tenantId,
          commandMatch[1],
          membership.userId,
          command.type,
          command.payload,
          Date.now() + command.ttlSeconds * 1000,
        );
        return created ? response(202, created) : response(404, { message: 'device not found' });
      }
      return response(404, { message: 'route not found' });
    } catch (error) {
      if (error instanceof InputError) return response(400, { message: error.message });
      if (isTransactionConflict(error))
        return response(409, { message: 'uniqueId already exists' });
      console.error('api request failed', error);
      return response(503, { message: 'temporarily unavailable' });
    }
  };
}

async function createInvitation(
  invitations: InvitationStore,
  tenantId: string,
  device: { deviceId: string; name: string; uniqueId: string; retentionDays: number },
  onboardingWebUrl: string,
) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const code = randomCode();
    const codeHash = hash(code);
    const createdAt = Date.now();
    try {
      await invitations.create({
        codeHash,
        tenantId,
        deviceId: device.deviceId,
        deviceName: device.name,
        uniqueId: device.uniqueId,
        retentionDays: device.retentionDays,
        status: 'waiting',
        createdAt,
        expiresAt: Math.floor(createdAt / 1000) + 86_400,
      });
      return {
        invitationId: codeHash,
        code,
        link: `${onboardingWebUrl.replace(/\/$/, '')}/onboard/#${code}`,
        status: 'waiting',
        createdAt,
        expiresAt: Math.floor(createdAt / 1000) + 86_400,
      };
    } catch (error) {
      if (!isCodeConflict(error) || attempt === 3) throw error;
    }
  }
  throw new Error('unable to allocate onboarding code');
}

function publicInvitation(invitation: OnboardingInvitation) {
  const expired =
    invitation.status === 'waiting' &&
    invitation.expiresAt !== undefined &&
    invitation.expiresAt <= Math.floor(Date.now() / 1000);
  return {
    invitationId: invitation.codeHash,
    status: expired ? 'expired' : invitation.status,
    createdAt: invitation.createdAt,
    expiresAt: invitation.expiresAt,
    activatedAt: invitation.activatedAt,
  };
}

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('');
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function parseCommand(body: string | undefined, role: Membership['role']) {
  if (!body) throw new InputError('request body is required');
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new InputError('request body must be JSON');
  }
  if (!isRecord(value)) throw new InputError('request body must be an object');
  const type = text(value.type, 'type', 2, 32);
  if (!['engineStop', 'engineResume', 'custom'].includes(type))
    throw new InputError('command type is unsupported');
  if ((type === 'engineStop' || type === 'engineResume') && role !== 'admin')
    throw new InputError('engine commands require an administrator');
  const ttlSeconds = boundedNumber(value.ttlSeconds, 300, 30, 900);
  const payload = isRecord(value.payload) ? value.payload : {};
  return { type, ttlSeconds, payload };
}

function day(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new InputError('date must be YYYY-MM-DD');
  return value;
}

function parseDevice(body: string | undefined): DeviceInput {
  if (!body) throw new InputError('request body is required');
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new InputError('request body must be JSON');
  }
  if (!isRecord(value)) throw new InputError('request body must be an object');
  const name = text(value.name, 'name', 1, 100);
  const uniqueId = text(value.uniqueId, 'uniqueId', 5, 64);
  const protocol = text(value.protocol, 'protocol', 2, 32);
  if (!['gt06', 'teltonika', 'osmand'].includes(protocol))
    throw new InputError('protocol is unsupported');
  const retentionDays = boundedNumber(value.retentionDays, 90, 1, 3_650);
  const groupId = value.groupId === undefined ? 'UNGROUPED' : text(value.groupId, 'groupId', 1, 64);
  return { name, uniqueId, protocol, retentionDays, groupId };
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max)
    throw new InputError('numeric parameter is outside its allowed range');
  return Math.round(number);
}

function text(value: unknown, name: string, min: number, max: number): string {
  if (typeof value !== 'string' || value.length < min || value.length > max)
    throw new InputError(`${name} is invalid`);
  return value;
}

function response(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTransactionConflict(error: unknown) {
  return error instanceof Error && error.name === 'TransactionCanceledException';
}

function isCodeConflict(error: unknown) {
  return error instanceof Error && error.name === 'ConditionalCheckFailedException';
}

class InputError extends Error {}

const client = createDocumentClient();
export const handler = createHandler(
  new DynamoFleetStore(
    client,
    requiredEnv('CORE_TABLE'),
    requiredEnv('DEVICE_STATE_TABLE'),
    requiredEnv('POSITIONS_TABLE'),
    {
      events: requiredEnv('EVENTS_TABLE'),
      trips: requiredEnv('TRIPS_TABLE'),
      dailyStats: requiredEnv('DAILY_STATS_TABLE'),
      commands: requiredEnv('COMMANDS_TABLE'),
    },
  ),
  new DynamoOnboardingStore(client, requiredEnv('ONBOARDING_TABLE')),
  requiredEnv('ONBOARDING_WEB_URL'),
);

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}

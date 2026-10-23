import { createDocumentClient, DynamoFleetStore, type Membership } from '@trackify/data';
import { channels } from '@trackify/realtime';

interface SubscribeEvent {
  operation: 'SUBSCRIBE';
  channel: string;
  identity?: { sub?: string };
  info?: { channel?: { path?: string } };
}

interface MembershipReader {
  membership(subject: string): Promise<Membership | undefined>;
}

export function createHandler(store: MembershipReader) {
  return async (event: SubscribeEvent) => {
    const subject = event.identity?.sub;
    const channel = event.info?.channel?.path ?? event.channel;
    if (!subject || !channel) throw unauthorized();
    const membership = await store.membership(subject);
    if (!membership || !allowedChannels(membership).includes(channel)) throw unauthorized();
    return null;
  };
}

/**
 * A user limited to groups gets only those groups' live positions; everyone else the whole fleet.
 * Each user also has a private channel for their notifications.
 */
export function allowedChannels(membership: Membership): string[] {
  const { tenantId, userId, role, groupIds } = membership;
  const limited = role !== 'admin' && groupIds.length > 0;
  return [
    ...(limited
      ? groupIds.map((groupId) => channels.group(tenantId, groupId))
      : [channels.fleet(tenantId)]),
    channels.user(tenantId, userId),
  ];
}

function unauthorized() {
  const error = new Error('Unauthorized');
  error.name = 'UnauthorizedException';
  return error;
}

const client = createDocumentClient();
export const handler = createHandler(
  new DynamoFleetStore(client, requiredEnv('CORE_TABLE'), '', ''),
);

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}

import { createDocumentClient, DynamoFleetStore } from '@trackify/data';

interface SubscribeEvent {
  operation: 'SUBSCRIBE';
  channel: string;
  identity?: { sub?: string };
  info?: { channel?: { path?: string } };
}

interface MembershipReader {
  membership(subject: string): Promise<{ tenantId: string } | undefined>;
}

export function createHandler(store: MembershipReader) {
  return async (event: SubscribeEvent) => {
    const subject = event.identity?.sub;
    const channel = event.info?.channel?.path ?? event.channel;
    if (!subject || !channel) throw unauthorized();
    const membership = await store.membership(subject);
    if (!membership || channel !== `/fleet/${membership.tenantId}`) throw unauthorized();
    return null;
  };
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

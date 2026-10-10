import { createHash, randomBytes } from 'node:crypto';
import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import { tenantPartitionKey } from './keys';

/** A public, expiring link to one vehicle's live location. */
export interface ShareLink {
  shareId: string;
  tenantId: string;
  deviceId: string;
  createdBy: string;
  createdAt: number;
  expiresAtMs: number;
}

/** Only a hash of the token is stored, so a database read never reveals working links. */
export function shareTokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Each link is two items written together: SHARE#<hash> resolves a token without knowing the
 * tenant, and a tenant-side item lists a vehicle's links. Both expire on their own.
 */
export class DynamoShareStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly coreTable: string,
  ) {}

  async create(
    input: Omit<ShareLink, 'shareId' | 'createdAt'>,
    now = Date.now(),
  ): Promise<ShareLink & { token: string }> {
    const token = randomBytes(24).toString('base64url');
    const shareId = shareTokenHash(token).slice(0, 32);
    const link: ShareLink = { ...input, shareId, createdAt: now };
    const expiresAt = Math.floor(input.expiresAtMs / 1000);
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.coreTable,
              Item: { pk: `SHARE#${shareTokenHash(token)}`, sk: 'SHARE', ...link, expiresAt },
              ConditionExpression: 'attribute_not_exists(pk)',
            },
          },
          {
            Put: {
              TableName: this.coreTable,
              Item: {
                pk: tenantPartitionKey(input.tenantId),
                sk: `SHARELINK#${input.deviceId}#${shareId}`,
                ...link,
                tokenHash: shareTokenHash(token),
                expiresAt,
              },
            },
          },
        ],
      }),
    );
    return { ...link, token };
  }

  /** The link behind a token, if it exists and has not expired (TTL deletion lags). */
  async resolve(token: string, now = Date.now()): Promise<ShareLink | undefined> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.coreTable,
        Key: { pk: `SHARE#${shareTokenHash(token)}`, sk: 'SHARE' },
      }),
    );
    const item = result.Item;
    if (!item || Number(item.expiresAtMs) <= now) return undefined;
    return toLink(item);
  }

  async list(tenantId: string, deviceId: string, now = Date.now()): Promise<ShareLink[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.coreTable,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: {
          ':pk': tenantPartitionKey(tenantId),
          ':prefix': `SHARELINK#${deviceId}#`,
        },
      }),
    );
    return (result.Items ?? []).map(toLink).filter((link) => link.expiresAtMs > now);
  }

  async revoke(tenantId: string, deviceId: string, shareId: string): Promise<boolean> {
    const listed = await this.client.send(
      new GetCommand({
        TableName: this.coreTable,
        Key: { pk: tenantPartitionKey(tenantId), sk: `SHARELINK#${deviceId}#${shareId}` },
      }),
    );
    const tokenHash: unknown = listed.Item?.tokenHash;
    if (typeof tokenHash !== 'string') return false;
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          { Delete: { TableName: this.coreTable, Key: { pk: `SHARE#${tokenHash}`, sk: 'SHARE' } } },
          {
            Delete: {
              TableName: this.coreTable,
              Key: { pk: tenantPartitionKey(tenantId), sk: `SHARELINK#${deviceId}#${shareId}` },
            },
          },
        ],
      }),
    );
    return true;
  }
}

function toLink(item: Record<string, unknown>): ShareLink {
  return {
    shareId: String(item.shareId),
    tenantId: String(item.tenantId),
    deviceId: String(item.deviceId),
    createdBy: String(item.createdBy),
    createdAt: Number(item.createdAt),
    expiresAtMs: Number(item.expiresAtMs),
  };
}

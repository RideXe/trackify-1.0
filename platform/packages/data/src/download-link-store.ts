import { randomBytes } from 'node:crypto';
import { GetCommand, PutCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/** How long a shared driver-app download link works. */
export const DOWNLOAD_LINK_LIFETIME_MS = 24 * 3_600_000;

/**
 * Expiring links to the driver app. A link is a random code; downloading checks it here, so no
 * permanent public address exists and a leaked link stops working the next day. Expired codes
 * are also removed by the table's time-to-live.
 */
export class DynamoDownloadLinkStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly coreTable: string,
  ) {}

  async create(tenantId: string, createdBy: string, now = Date.now()) {
    const token = randomBytes(24).toString('base64url');
    const expiresAt = now + DOWNLOAD_LINK_LIFETIME_MS;
    await this.client.send(
      new PutCommand({
        TableName: this.coreTable,
        Item: {
          pk: `DOWNLOAD#${token}`,
          sk: 'LINK',
          tenantId,
          createdBy,
          createdAt: now,
          validUntil: expiresAt,
          expiresAt: Math.floor(expiresAt / 1000),
        },
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
    return { token, expiresAt };
  }

  /** Whether a code is real and still valid. */
  async valid(token: string, now = Date.now()): Promise<boolean> {
    if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return false;
    const result = await this.client.send(
      new GetCommand({ TableName: this.coreTable, Key: { pk: `DOWNLOAD#${token}`, sk: 'LINK' } }),
    );
    return typeof result.Item?.validUntil === 'number' && result.Item.validUntil > now;
  }
}

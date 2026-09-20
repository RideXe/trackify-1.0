import { GetCommand, QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { uniqueIdLookupKey } from './keys';

export interface DeviceIdentity {
  tenantId: string;
  deviceId: string;
  uniqueId: string;
  protocol: string;
  retentionDays: number;
}

export interface DeviceDirectory {
  resolve(uniqueId: string): Promise<DeviceIdentity | undefined>;
}

export class DynamoDeviceDirectory implements DeviceDirectory {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async resolve(uniqueId: string): Promise<DeviceIdentity | undefined> {
    const lookup = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'byUniqueId',
        KeyConditionExpression: 'lookupPk = :pk',
        ExpressionAttributeValues: { ':pk': uniqueIdLookupKey(uniqueId) },
        Limit: 2,
        ConsistentRead: false,
      }),
    );
    if ((lookup.Count ?? 0) > 1) throw new Error(`duplicate registered uniqueId: ${uniqueId}`);
    const pointer: unknown = lookup.Items?.[0];
    if (pointer === undefined) return undefined;
    if (!isRecord(pointer)) throw new Error(`invalid device lookup for uniqueId: ${uniqueId}`);
    const pk = pointer.pk;
    const sk = pointer.sk;
    if (typeof pk !== 'string' || typeof sk !== 'string') {
      throw new Error(`invalid device lookup pointer for uniqueId: ${uniqueId}`);
    }
    const item = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk, sk },
        ConsistentRead: true,
      }),
    );
    if (!item.Item || item.Item.enabled === false) return undefined;
    return {
      tenantId: String(item.Item.tenantId),
      deviceId: String(item.Item.deviceId),
      uniqueId: String(item.Item.uniqueId),
      protocol: String(item.Item.protocol),
      retentionDays: Number(item.Item.retentionDays ?? 90),
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

import {
  QueryCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import { deterministicId } from '@trackify/fleet';

export class DynamoOfflineStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly stateTable: string,
    private readonly eventsTable: string,
  ) {}

  async markStale(cutoff: number, limit = 100): Promise<number> {
    let lastKey: Record<string, unknown> | undefined;
    let updated = 0;
    do {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.stateTable,
          IndexName: 'byStaleness',
          KeyConditionExpression: 'stalePk = :online AND staleSk < :cutoff',
          ExpressionAttributeValues: { ':online': 'ONLINE', ':cutoff': cutoff },
          Limit: Math.min(100, limit - updated),
          ExclusiveStartKey: lastKey,
        }),
      );
      for (const item of result.Items ?? []) {
        const pk = String(item.pk);
        const tenantId = String(item.tenantId);
        const deviceId = String(item.deviceId);
        const eventId = deterministicId(
          deviceId,
          'deviceOffline',
          Number(item.lastSeenAt ?? cutoff),
        );
        try {
          await this.client.send(
            new TransactWriteCommand({
              TransactItems: [
                {
                  Update: {
                    TableName: this.stateTable,
                    Key: { pk },
                    UpdateExpression: 'SET #status = :offline REMOVE stalePk, staleSk',
                    ConditionExpression: 'staleSk < :cutoff AND #status = :online',
                    ExpressionAttributeNames: { '#status': 'status' },
                    ExpressionAttributeValues: {
                      ':offline': 'offline',
                      ':online': 'online',
                      ':cutoff': cutoff,
                    },
                  },
                },
                {
                  Put: {
                    TableName: this.eventsTable,
                    Item: {
                      pk,
                      sk: `${String(cutoff).padStart(13, '0')}#${eventId}`,
                      v: 1,
                      eventId,
                      tenantId,
                      deviceId,
                      type: 'deviceOffline',
                      eventTime: cutoff,
                      attributes: {},
                      tenantMonthPk: `${tenantId}#${new Date(cutoff).toISOString().slice(0, 7)}`,
                      tenantMonthSk: `${String(cutoff).padStart(13, '0')}#${eventId}`,
                      expiresAt: Math.floor(cutoff / 1000) + 365 * 86_400,
                    },
                    ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
                  },
                },
              ],
            }),
          );
          updated += 1;
        } catch (error) {
          if (!(error instanceof Error && error.name === 'TransactionCanceledException'))
            throw error;
        }
      }
      lastKey = result.LastEvaluatedKey;
    } while (lastKey && updated < limit);
    return updated;
  }
}

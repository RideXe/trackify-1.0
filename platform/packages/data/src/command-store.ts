import { QueryCommand, UpdateCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export class DynamoCommandStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async expirePending(now: number, limit = 1_000): Promise<number> {
    let lastKey: Record<string, unknown> | undefined;
    let updated = 0;
    do {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: 'byStatus',
          KeyConditionExpression: 'statusPk = :pending AND statusSk < :cutoff',
          ExpressionAttributeValues: {
            ':pending': 'PENDING',
            ':cutoff': `${String(now).padStart(13, '0')}#~`,
          },
          ExclusiveStartKey: lastKey,
          Limit: Math.min(100, limit - updated),
        }),
      );
      for (const item of result.Items ?? []) {
        try {
          await this.client.send(
            new UpdateCommand({
              TableName: this.tableName,
              Key: { pk: String(item.pk), sk: String(item.sk) },
              UpdateExpression:
                'SET #status = :expired, completedAt = :now REMOVE statusPk, statusSk',
              ConditionExpression: '#status = :pendingStatus AND expiresAtMs <= :now',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: {
                ':expired': 'expired',
                ':pendingStatus': 'pending',
                ':now': now,
              },
            }),
          );
          updated += 1;
        } catch (error) {
          if (!(error instanceof Error && error.name === 'ConditionalCheckFailedException'))
            throw error;
        }
      }
      lastKey = result.LastEvaluatedKey;
    } while (lastKey && updated < limit);
    return updated;
  }
}

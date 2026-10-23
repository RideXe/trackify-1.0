import { UpdateCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { staleSortKey } from '@trackify/domain';
import { devicePartitionKey } from './keys';

/**
 * Records that a tracker was heard from without a new live position: a phone checking in with no
 * usable GPS fix (indoors, weak signal), or a position the processor did not keep (it arrived
 * late, or failed the plausibility checks). Without this a working phone looks offline.
 */
export class DynamoPresenceStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly stateTable: string,
  ) {}

  /** False when the vehicle has never reported a position, or a later contact is already stored. */
  async markSeen(
    tenantId: string,
    deviceId: string,
    seenAt: number,
    syncIntervalSeconds?: number,
  ): Promise<boolean> {
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.stateTable,
          Key: { pk: devicePartitionKey(tenantId, deviceId) },
          // Only vehicles with a live record: the dashboard needs a first position to show one.
          ConditionExpression:
            'attribute_exists(pk) AND (attribute_not_exists(lastSeenAt) OR lastSeenAt < :seen)',
          UpdateExpression:
            'SET lastSeenAt = :seen, #status = :online, stalePk = :stalePk, staleSk = :staleSk',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':seen': seenAt,
            ':online': 'online',
            ':stalePk': 'ONLINE',
            ':staleSk': staleSortKey(seenAt, syncIntervalSeconds),
          },
        }),
      );
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') return false;
      throw error;
    }
  }
}

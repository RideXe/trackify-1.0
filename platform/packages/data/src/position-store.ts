import type { PositionMessage } from '@trackify/domain';
import { PutCommand, UpdateCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { devicePartitionKey, positionSortKey, ttlSeconds } from './keys';

export interface PositionStore {
  save(position: PositionMessage, retentionDays: number): Promise<void>;
}

export class DynamoPositionStore implements PositionStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly positionsTable: string,
    private readonly stateTable: string,
  ) {}

  async save(position: PositionMessage, retentionDays: number): Promise<void> {
    const pk = devicePartitionKey(position.tenantId, position.deviceId);
    await this.client.send(
      new PutCommand({
        TableName: this.positionsTable,
        Item: {
          pk,
          sk: positionSortKey(position),
          ...position,
          expiresAt: ttlSeconds(position.fixTime, retentionDays),
        },
      }),
    );

    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.stateTable,
          Key: { pk },
          ConditionExpression: 'attribute_not_exists(fixTime) OR fixTime < :fixTime',
          UpdateExpression: [
            'SET tenantId = :tenantId, deviceId = :deviceId, groupId = :groupId,',
            'fixTime = :fixTime, lastSeenAt = :receivedAt, #status = :online,',
            'latitude = :latitude, longitude = :longitude, valid = :valid,',
            'speedKmh = :speedKmh, courseDeg = :courseDeg, attributes = :attributes,',
            'tenantPk = :tenantId, tenantSk = :deviceId, stalePk = :stalePk, staleSk = :receivedAt',
          ].join(' '),
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':tenantId': position.tenantId,
            ':deviceId': position.deviceId,
            ':groupId': 'UNGROUPED',
            ':fixTime': position.fixTime,
            ':receivedAt': position.receivedAt,
            ':online': 'online',
            ':latitude': position.latitude,
            ':longitude': position.longitude,
            ':valid': position.valid,
            ':speedKmh': position.speedKmh ?? 0,
            ':courseDeg': position.courseDeg ?? 0,
            ':attributes': position.attributes,
            ':stalePk': `ONLINE#${position.tenantId}`,
          },
        }),
      );
    } catch (error) {
      if (isConditionalFailure(error)) return;
      throw error;
    }
  }
}

function isConditionalFailure(error: unknown): boolean {
  return error instanceof Error && error.name === 'ConditionalCheckFailedException';
}

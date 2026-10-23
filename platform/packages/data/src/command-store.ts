import {
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import type { EventMessage } from '@trackify/domain';
import { ulid } from 'ulid';
import { eventItem, ttlSeconds } from './keys';

/** A command waiting for its vehicle, as the gateway sees it. */
export interface PendingCommand {
  pk: string;
  sk: string;
  commandId: string;
  tenantId: string;
  deviceId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

export type CommandKey = Pick<PendingCommand, 'pk' | 'sk'>;

const pad = (time: number) => String(time).padStart(13, '0');

export class DynamoCommandStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly eventsTable?: string,
  ) {}

  /**
   * Commands still waiting and not yet expired, oldest deadline first. Reads only the sparse
   * PENDING index, so the cost depends on how many commands are waiting, not on fleet size.
   */
  async pending(now: number, limit = 500): Promise<PendingCommand[]> {
    const items: PendingCommand[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: 'byStatus',
          KeyConditionExpression: 'statusPk = :pending AND statusSk > :now',
          ExpressionAttributeValues: { ':pending': 'PENDING', ':now': pad(now) },
          ExclusiveStartKey: lastKey,
          Limit: Math.min(100, limit - items.length),
        }),
      );
      items.push(...((result.Items ?? []) as PendingCommand[]));
      lastKey = result.LastEvaluatedKey;
    } while (lastKey && items.length < limit);
    return items;
  }

  /** Claims a waiting command for sending; false when another gateway task or expiry got it. */
  async markSent(key: CommandKey, now: number, correlation?: number): Promise<boolean> {
    return this.transition(
      key,
      'SET #status = :sent, sentAt = :now, correlation = :correlation REMOVE statusPk, statusSk',
      '#status = :pending AND expiresAtMs > :now',
      { ':sent': 'sent', ':pending': 'pending', ':now': now, ':correlation': correlation ?? null },
    );
  }

  async markFailed(key: CommandKey, now: number, reason: string): Promise<boolean> {
    return this.transition(
      key,
      'SET #status = :failed, completedAt = :now, failure = :reason REMOVE statusPk, statusSk',
      '#status IN (:pending, :sent)',
      {
        ':failed': 'failed',
        ':pending': 'pending',
        ':sent': 'sent',
        ':now': now,
        ':reason': reason,
      },
    );
  }

  async markDelivered(key: CommandKey, now: number, result: string): Promise<boolean> {
    return this.transition(
      key,
      'SET #status = :delivered, completedAt = :now, #result = :result',
      '#status = :sent',
      { ':delivered': 'delivered', ':sent': 'sent', ':now': now, ':result': result },
      { '#result': 'result' },
    );
  }

  /** Records a commandResult or queuedCommandSent event, which alert rules can notify on. */
  async recordEvent(
    event: Omit<EventMessage, 'v' | 'eventId'> & { eventId?: string },
  ): Promise<void> {
    if (!this.eventsTable) throw new Error('events table is not configured');
    const complete: EventMessage = {
      v: 1,
      eventId: event.eventId ?? ulid(event.eventTime),
      ...event,
    };
    await this.client.send(
      new PutCommand({
        TableName: this.eventsTable,
        Item: eventItem(complete, ttlSeconds(complete.eventTime, 365)),
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
  }

  private async transition(
    key: CommandKey,
    update: string,
    condition: string,
    values: Record<string, unknown>,
    names: Record<string, string> = {},
  ) {
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk: key.pk, sk: key.sk },
          UpdateExpression: update,
          ConditionExpression: condition,
          ExpressionAttributeNames: { '#status': 'status', ...names },
          ExpressionAttributeValues: values,
        }),
      );
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') return false;
      throw error;
    }
  }

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

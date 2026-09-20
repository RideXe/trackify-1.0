import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import type { TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';
import type { PositionMessage } from '@trackify/domain';
import {
  evaluatePosition,
  isPlausibleLiveFix,
  type FleetRules,
  type FleetState,
  type GeofenceRule,
} from '@trackify/fleet';
import { devicePartitionKey, positionSortKey, tenantPartitionKey, ttlSeconds } from './keys';

export interface FleetProcessingStore {
  process(position: PositionMessage): Promise<{ duplicate: boolean; eventCount: number }>;
}

export class DynamoFleetProcessingStore implements FleetProcessingStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tables: {
      core: string;
      positions: string;
      state: string;
      events: string;
      trips: string;
      dailyStats: string;
    },
  ) {}

  async process(position: PositionMessage): Promise<{ duplicate: boolean; eventCount: number }> {
    const pk = devicePartitionKey(position.tenantId, position.deviceId);
    const [stateResult, deviceResult, geofenceResult] = await Promise.all([
      this.client.send(
        new GetCommand({ TableName: this.tables.state, Key: { pk }, ConsistentRead: true }),
      ),
      this.client.send(
        new GetCommand({
          TableName: this.tables.core,
          Key: { pk: tenantPartitionKey(position.tenantId), sk: `DEVICE#${position.deviceId}` },
        }),
      ),
      this.client.send(
        new QueryCommand({
          TableName: this.tables.core,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
          ExpressionAttributeValues: {
            ':pk': tenantPartitionKey(position.tenantId),
            ':prefix': 'GEOFENCE#',
          },
        }),
      ),
    ]);
    const previous = toFleetState(stateResult.Item);
    if (previous && previous.fixTime >= position.fixTime) {
      await this.putHistoricalPosition(position, pk);
      return { duplicate: previous.fixTime === position.fixTime, eventCount: 0 };
    }
    if (!isPlausibleLiveFix(previous, position)) {
      await this.putHistoricalPosition(position, pk);
      return { duplicate: false, eventCount: 0 };
    }
    const transition = evaluatePosition(
      previous,
      position,
      toRules(deviceResult.Item, geofenceResult.Items ?? []),
    );
    const expiresAt = ttlSeconds(position.fixTime, position.retentionDays);
    const eventExpiresAt = ttlSeconds(position.fixTime, 365);
    const transaction: NonNullable<TransactWriteCommandInput['TransactItems']> = [
      {
        Put: {
          TableName: this.tables.positions,
          Item: { pk, sk: positionSortKey(position), ...position, expiresAt },
          ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
        },
      },
      {
        Put: {
          TableName: this.tables.state,
          Item: {
            pk,
            tenantPk: position.tenantId,
            tenantSk: position.deviceId,
            stalePk: 'ONLINE',
            staleSk: position.receivedAt,
            tenantId: position.tenantId,
            deviceId: position.deviceId,
            groupId: 'UNGROUPED',
            status: 'online',
            lastSeenAt: position.receivedAt,
            speedKmh: position.speedKmh ?? 0,
            courseDeg: position.courseDeg ?? 0,
            valid: position.valid,
            attributes: position.attributes,
            ...transition.state,
          },
          ConditionExpression: 'attribute_not_exists(fixTime) OR fixTime < :fixTime',
          ExpressionAttributeValues: { ':fixTime': position.fixTime },
        },
      },
      ...transition.events.map((event) => ({
        Put: {
          TableName: this.tables.events,
          Item: {
            pk,
            sk: `${String(event.eventTime).padStart(13, '0')}#${event.eventId}`,
            ...event,
            tenantMonthPk: `${event.tenantId}#${new Date(event.eventTime).toISOString().slice(0, 7)}`,
            tenantMonthSk: `${String(event.eventTime).padStart(13, '0')}#${event.eventId}`,
            expiresAt: eventExpiresAt,
          },
          ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
        },
      })),
    ];
    if (transition.completedTrip) {
      const trip = transition.completedTrip;
      transaction.push({
        Put: {
          TableName: this.tables.trips,
          Item: {
            pk,
            sk: `${String(trip.startTime).padStart(13, '0')}#${trip.tripId}`,
            tenantId: position.tenantId,
            deviceId: position.deviceId,
            ...trip,
            expiresAt: ttlSeconds(trip.startTime, 730),
          },
          ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
        },
      });
      const day = new Date(trip.startTime).toISOString().slice(0, 10);
      transaction.push({
        Update: {
          TableName: this.tables.dailyStats,
          Key: { pk, sk: day },
          UpdateExpression: 'ADD distanceM :distance, tripCount :one SET expiresAt = :expiresAt',
          ExpressionAttributeValues: {
            ':distance': Math.round(trip.distanceM),
            ':one': 1,
            ':expiresAt': ttlSeconds(trip.startTime, 730),
          },
        },
      });
    }
    try {
      await this.client.send(new TransactWriteCommand({ TransactItems: transaction }));
      return { duplicate: false, eventCount: transition.events.length };
    } catch (error) {
      if (isTransactionCanceled(error)) return { duplicate: true, eventCount: 0 };
      throw error;
    }
  }

  private async putHistoricalPosition(position: PositionMessage, pk: string) {
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.tables.positions,
                Item: {
                  pk,
                  sk: positionSortKey(position),
                  ...position,
                  expiresAt: ttlSeconds(position.fixTime, position.retentionDays),
                },
                ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
              },
            },
          ],
        }),
      );
    } catch (error) {
      if (!isTransactionCanceled(error)) throw error;
    }
  }
}

function toFleetState(item: Record<string, unknown> | undefined): FleetState | undefined {
  if (!item || typeof item.fixTime !== 'number') return undefined;
  return {
    fixTime: item.fixTime,
    latitude: Number(item.latitude),
    longitude: Number(item.longitude),
    motion: item.motion === true,
    ignition: typeof item.ignition === 'boolean' ? item.ignition : undefined,
    overspeeding: item.overspeeding === true,
    geofencesInside: Array.isArray(item.geofencesInside) ? item.geofencesInside.map(String) : [],
    odometerM: Number(item.odometerM ?? 0),
    trip: isRecord(item.trip) ? (item.trip as unknown as FleetState['trip']) : undefined,
  };
}

function toRules(
  device: Record<string, unknown> | undefined,
  geofenceItems: Record<string, unknown>[],
): FleetRules {
  const geofences: GeofenceRule[] = geofenceItems.flatMap((item) => {
    const shape = toShape(item.shape);
    return shape ? [{ id: String(item.geofenceId), shape }] : [];
  });
  return {
    speedLimitKmh: typeof device?.speedLimitKmh === 'number' ? device.speedLimitKmh : undefined,
    geofences,
  };
}

function toShape(value: unknown): GeofenceRule['shape'] | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type === 'circle' && isRecord(value.center) && typeof value.radiusM === 'number') {
    const latitude = value.center.latitude;
    const longitude = value.center.longitude;
    if (typeof latitude === 'number' && typeof longitude === 'number') {
      return { type: 'circle', center: { latitude, longitude }, radiusM: value.radiusM };
    }
  }
  if (value.type === 'polygon' && Array.isArray(value.points)) {
    const points = value.points.flatMap((point) => {
      if (
        !isRecord(point) ||
        typeof point.latitude !== 'number' ||
        typeof point.longitude !== 'number'
      )
        return [];
      return [{ latitude: point.latitude, longitude: point.longitude }];
    });
    if (points.length >= 3) return { type: 'polygon', points };
  }
  return undefined;
}

function isTransactionCanceled(error: unknown) {
  return error instanceof Error && error.name === 'TransactionCanceledException';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

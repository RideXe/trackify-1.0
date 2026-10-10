import {
  BatchGetCommand,
  GetCommand,
  UpdateCommand,
  QueryCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import type { TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';
import { staleSortKey, type PositionMessage } from '@trackify/domain';
import { noGeocoder, type Geocoder } from '@trackify/geocoder';
import { DynamoPresenceStore } from './presence-store';
import {
  applyComputed,
  assessFix,
  evaluatePosition,
  maxSpeedFor,
  type ComputedAttribute,
  type FleetRules,
  type FleetState,
  type GeofenceRule,
  type LinkedVehicle,
  type MaintenanceRule,
  type Suspect,
} from '@trackify/fleet';
import {
  devicePartitionKey,
  eventItem,
  positionSortKey,
  tenantPartitionKey,
  ttlSeconds,
} from './keys';

/** Where the vehicle now shows on the map; drift-filtered, so it can differ from the raw fix. */
export interface LivePosition {
  latitude: number;
  longitude: number;
  speedKmh: number;
}

export interface FleetProcessingStore {
  /** `live` is set only when this reading updated the vehicle's live state. */
  process(position: PositionMessage): Promise<ProcessResult>;
}

export interface ProcessResult {
  duplicate: boolean;
  eventCount: number;
  live?: LivePosition;
  /** The vehicle's group, for live updates to users limited to it. */
  groupId?: string;
  /** The position as stored, with computed attributes applied. */
  position?: PositionMessage;
}

/** Tenant configuration that processing applies to every position. */
interface TenantConfig {
  geofences: GeofenceRule[];
  computed: Array<ComputedAttribute & { order: number }>;
  maintenances: Array<MaintenanceRule & { deviceIds: string[]; groupIds: string[] }>;
}

/**
 * Configuration is read at most once a minute per tenant and Lambda instance, instead of on every
 * position (data-access-patterns AP-15). Edits therefore apply within about a minute.
 */
const CONFIG_TTL_MS = 60_000;
const MAX_CACHED_TENANTS = 500;
const MAX_LINKED_VEHICLES = 10;

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
    private readonly now: () => number = Date.now,
    private readonly geocoder: Geocoder = noGeocoder,
  ) {}

  private readonly configs = new Map<string, { config: TenantConfig; expires: number }>();

  async process(raw: PositionMessage): Promise<ProcessResult> {
    const pk = devicePartitionKey(raw.tenantId, raw.deviceId);
    const [stateResult, deviceResult, config] = await Promise.all([
      this.client.send(
        new GetCommand({ TableName: this.tables.state, Key: { pk }, ConsistentRead: true }),
      ),
      this.client.send(
        new GetCommand({
          TableName: this.tables.core,
          Key: { pk: tenantPartitionKey(raw.tenantId), sk: `DEVICE#${raw.deviceId}` },
        }),
      ),
      this.tenantConfig(raw.tenantId),
    ]);
    const groupId = groupOf(deviceResult.Item);
    const position = applyComputed(raw, config.computed, groupId);
    const reset = accumulatorReset(deviceResult.Item, stateResult.Item);
    const stored = toFleetState(stateResult.Item);
    // An administrator's odometer or engine-hours correction replaces the running totals once.
    const previous =
      stored && reset
        ? {
            ...stored,
            odometerM: reset.odometerM ?? stored.odometerM,
            engineHoursS: reset.engineHoursS ?? stored.engineHoursS,
          }
        : stored;
    if (previous && previous.fixTime >= position.fixTime) {
      await this.putHistoricalPosition(position, pk);
      // A late or repeated position still proves the tracker is alive.
      await this.markSeen(position);
      return { duplicate: previous.fixTime === position.fixTime, eventCount: 0 };
    }
    const verdict = assessFix(
      previous && { ...previous, suspect: toSuspect(stateResult.Item?.suspect) },
      position,
      maxSpeedFor(deviceResult.Item?.vehicleType),
    );
    if (!verdict.accept) {
      // Kept in history with the reason, so a support check can see why the map skipped it.
      await this.putHistoricalPosition(
        { ...position, attributes: { ...position.attributes, rejectedReason: verdict.reason } },
        pk,
      );
      if (verdict.suspect && stateResult.Item) await this.rememberSuspect(pk, verdict.suspect);
      await this.markSeen(position);
      return { duplicate: false, eventCount: 0 };
    }
    const linked = await this.linkedVehicles(position.tenantId, deviceResult.Item);
    const transition = evaluatePosition(
      previous,
      position,
      toRules(deviceResult.Item, config, groupId, linked),
      { relocated: verdict.relocated },
    );
    await this.addTripAddresses(transition);
    // A correction entered before the first report becomes the starting totals.
    if (!stored && reset) {
      if (reset.odometerM !== undefined) transition.state.odometerM += reset.odometerM;
      if (reset.engineHoursS !== undefined)
        transition.state.engineHoursS = (transition.state.engineHoursS ?? 0) + reset.engineHoursS;
    }
    const expiresAt = ttlSeconds(position.fixTime, position.retentionDays);
    // A check-in may have been recorded after this position was received.
    const seenAt = Math.max(position.receivedAt, Number(stateResult.Item?.lastSeenAt ?? 0));
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
            staleSk: staleSortKey(seenAt, position.attributes.syncIntervalS),
            tenantId: position.tenantId,
            deviceId: position.deviceId,
            groupId: groupOf(deviceResult.Item),
            status: 'online',
            lastSeenAt: seenAt,
            speedKmh: position.speedKmh ?? 0,
            courseDeg: position.courseDeg ?? 0,
            valid: position.valid,
            attributes: position.attributes,
            ...transition.state,
            accumulatorsSetAt: reset?.setAt ?? optionalNumber(stateResult.Item?.accumulatorsSetAt),
          },
          ConditionExpression: 'attribute_not_exists(fixTime) OR fixTime < :fixTime',
          ExpressionAttributeValues: { ':fixTime': position.fixTime },
        },
      },
      ...transition.events.map((event) => ({
        Put: {
          TableName: this.tables.events,
          Item: eventItem(event, eventExpiresAt),
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
      const { latitude, longitude, speedKmh = 0 } = transition.state;
      return {
        duplicate: false,
        eventCount: transition.events.length,
        live: { latitude, longitude, speedKmh },
        groupId,
        position,
      };
    } catch (error) {
      if (isTransactionCanceled(error)) return { duplicate: true, eventCount: 0 };
      throw error;
    }
  }

  /** Trip start and end addresses, looked up once each; stored, so licensed for storage. */
  private async addTripAddresses(transition: ReturnType<typeof evaluatePosition>) {
    const trip = transition.state.trip;
    if (
      trip &&
      !trip.startAddress &&
      transition.events.some((event) => event.type === 'tripStarted')
    )
      trip.startAddress = await this.geocoder.address(
        trip.startLatitude,
        trip.startLongitude,
        'storage',
      );
    const completed = transition.completedTrip;
    if (completed)
      completed.endAddress = await this.geocoder.address(
        completed.endLatitude,
        completed.endLongitude,
        'storage',
      );
  }

  private async tenantConfig(tenantId: string): Promise<TenantConfig> {
    const cached = this.configs.get(tenantId);
    if (cached && cached.expires > this.now()) return cached.config;
    const [geofences, computed, maintenances] = await Promise.all(
      ['GEOFENCE#', 'COMPUTED#', 'MAINT#'].map((prefix) => this.listPrefix(tenantId, prefix)),
    );
    const config: TenantConfig = {
      geofences: geofences!.flatMap((item) => {
        const shape = toShape(item.shape);
        return shape ? [{ id: String(item.geofenceId), shape }] : [];
      }),
      computed: computed!
        .flatMap((item) => toComputed(item) ?? [])
        .sort((a, b) => a.order - b.order),
      maintenances: maintenances!.flatMap((item) => toMaintenance(item) ?? []),
    };
    if (this.configs.size >= MAX_CACHED_TENANTS) this.configs.clear();
    this.configs.set(tenantId, { config, expires: this.now() + CONFIG_TTL_MS });
    return config;
  }

  private async listPrefix(tenantId: string, prefix: string) {
    const items: Record<string, unknown>[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tables.core,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
          ExpressionAttributeValues: { ':pk': tenantPartitionKey(tenantId), ':prefix': prefix },
          ExclusiveStartKey: startKey,
        }),
      );
      items.push(...(result.Items ?? []));
      startKey = result.LastEvaluatedKey;
    } while (startKey);
    return items;
  }

  /** Where linked vehicles were last seen, read only for vehicles that have links. */
  private async linkedVehicles(
    tenantId: string,
    device: Record<string, unknown> | undefined,
  ): Promise<LinkedVehicle[]> {
    const proximity = isRecord(device?.proximity) ? device.proximity : undefined;
    const ids = Array.isArray(proximity?.linkedDeviceIds)
      ? proximity.linkedDeviceIds.map(String).slice(0, MAX_LINKED_VEHICLES)
      : [];
    if (!ids.length) return [];
    const result = await this.client.send(
      new BatchGetCommand({
        RequestItems: {
          [this.tables.state]: {
            Keys: ids.map((id) => ({ pk: devicePartitionKey(tenantId, id) })),
            ProjectionExpression: 'deviceId, tenantId, latitude, longitude',
          },
        },
      }),
    );
    return (result.Responses?.[this.tables.state] ?? []).flatMap((item) =>
      item.tenantId === tenantId &&
      typeof item.latitude === 'number' &&
      typeof item.longitude === 'number'
        ? [{ deviceId: String(item.deviceId), latitude: item.latitude, longitude: item.longitude }]
        : [],
    );
  }

  /** The latest held-out fix, so following fixes that agree with it can prove a real jump. */
  private async markSeen(position: PositionMessage) {
    await new DynamoPresenceStore(this.client, this.tables.state).markSeen(
      position.tenantId,
      position.deviceId,
      position.receivedAt,
      position.attributes.syncIntervalS,
    );
  }

  private async rememberSuspect(pk: string, suspect: Suspect) {
    await this.client
      .send(
        new UpdateCommand({
          TableName: this.tables.state,
          Key: { pk },
          UpdateExpression: 'SET suspect = :suspect',
          ConditionExpression: 'attribute_exists(pk)',
          ExpressionAttributeValues: { ':suspect': suspect },
        }),
      )
      .catch((error: unknown) => {
        if (!(error instanceof Error && error.name === 'ConditionalCheckFailedException'))
          throw error;
      });
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
    accuracyM: typeof item.accuracyM === 'number' ? item.accuracyM : undefined,
    speedKmh: typeof item.speedKmh === 'number' ? item.speedKmh : undefined,
    motion: item.motion === true,
    ignition: typeof item.ignition === 'boolean' ? item.ignition : undefined,
    overspeeding: item.overspeeding === true,
    geofencesInside: Array.isArray(item.geofencesInside) ? item.geofencesInside.map(String) : [],
    odometerM: Number(item.odometerM ?? 0),
    engineHoursS: typeof item.engineHoursS === 'number' ? item.engineHoursS : undefined,
    fuelLevelPct: typeof item.fuelLevelPct === 'number' ? item.fuelLevelPct : undefined,
    driverUniqueId: typeof item.driverUniqueId === 'string' ? item.driverUniqueId : undefined,
    trip: isRecord(item.trip) ? (item.trip as unknown as FleetState['trip']) : undefined,
  };
}

function toRules(
  device: Record<string, unknown> | undefined,
  config: TenantConfig,
  groupId: string,
  linked: LinkedVehicle[],
): FleetRules {
  const deviceId = typeof device?.deviceId === 'string' ? device.deviceId : '';
  const proximity = isRecord(device?.proximity) ? device.proximity : undefined;
  return {
    speedLimitKmh: positive(device?.speedLimitKmh),
    geofences: config.geofences,
    fuel: {
      dropThreshold: positive(device?.fuelDropThreshold),
      increaseThreshold: positive(device?.fuelIncreaseThreshold),
    },
    behaviour: {
      accelerationThresholdMs2: positive(device?.accelerationThresholdMs2),
      brakingThresholdMs2: positive(device?.brakingThresholdMs2),
    },
    proximity: proximity && {
      enterDistanceM: positive(proximity.enterDistanceM),
      exitDistanceM: positive(proximity.exitDistanceM),
      unaccompaniedDistanceM: positive(proximity.unaccompaniedDistanceM),
      linked,
    },
    maintenances: config.maintenances.filter(
      (rule) =>
        (!rule.deviceIds.length && !rule.groupIds.length) ||
        rule.deviceIds.includes(deviceId) ||
        rule.groupIds.includes(groupId),
    ),
  };
}

function positive(value: unknown) {
  return typeof value === 'number' && value > 0 ? value : undefined;
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

function groupOf(device: Record<string, unknown> | undefined) {
  return typeof device?.groupId === 'string' ? device.groupId : 'UNGROUPED';
}

function isTransactionCanceled(error: unknown) {
  return error instanceof Error && error.name === 'TransactionCanceledException';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function toComputed(
  item: Record<string, unknown>,
): (ComputedAttribute & { order: number }) | undefined {
  if (typeof item.expression !== 'string' || typeof item.attribute !== 'string') return undefined;
  const type = item.type === 'boolean' || item.type === 'string' ? item.type : 'number';
  return {
    attributeId: String(item.attributeId),
    attribute: item.attribute,
    expression: item.expression,
    type,
    deviceIds: strings(item.deviceIds),
    groupIds: strings(item.groupIds),
    order: typeof item.order === 'number' ? item.order : 0,
  };
}

function toMaintenance(
  item: Record<string, unknown>,
): (MaintenanceRule & { deviceIds: string[]; groupIds: string[] }) | undefined {
  const type = item.type;
  if (type !== 'odometerM' && type !== 'engineHoursS' && type !== 'fixTime') return undefined;
  if (typeof item.start !== 'number' || typeof item.period !== 'number') return undefined;
  return {
    maintenanceId: String(item.maintenanceId),
    name: String(item.name),
    type,
    start: item.start,
    period: item.period,
    deviceIds: strings(item.deviceIds),
    groupIds: strings(item.groupIds),
  };
}

/** A correction set on the device after the live state last applied one, if any. */
function accumulatorReset(
  device: Record<string, unknown> | undefined,
  state: Record<string, unknown> | undefined,
): { odometerM?: number; engineHoursS?: number; setAt: number } | undefined {
  const accumulators = isRecord(device?.accumulators) ? device.accumulators : undefined;
  const setAt = accumulators?.setAt;
  if (typeof setAt !== 'number') return undefined;
  const applied = typeof state?.accumulatorsSetAt === 'number' ? state.accumulatorsSetAt : 0;
  if (setAt <= applied) return undefined;
  return {
    setAt,
    odometerM: typeof accumulators?.odometerM === 'number' ? accumulators.odometerM : undefined,
    engineHoursS:
      typeof accumulators?.engineHoursS === 'number' ? accumulators.engineHoursS : undefined,
  };
}

function optionalNumber(value: unknown) {
  return typeof value === 'number' ? value : undefined;
}

function toSuspect(value: unknown): Suspect | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const suspect = value as Record<string, unknown>;
  return typeof suspect.latitude === 'number' &&
    typeof suspect.longitude === 'number' &&
    typeof suspect.fixTime === 'number' &&
    typeof suspect.count === 'number'
    ? {
        latitude: suspect.latitude,
        longitude: suspect.longitude,
        fixTime: suspect.fixTime,
        count: suspect.count,
      }
    : undefined;
}

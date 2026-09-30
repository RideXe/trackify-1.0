import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import {
  defaultVehicleType,
  isFuelType,
  isOneOf,
  pauseReasons,
  toVehicleType,
  type DutyStatus,
  type FuelType,
  type PauseReason,
  type VehicleType,
} from '@trackify/domain';
import { ulid } from 'ulid';
import { cognitoLookupKey, tenantPartitionKey, uniqueIdLookupKey } from './keys';
import { updateItem } from './update-item';

export type FleetRole = 'admin' | 'dispatcher' | 'viewer';

export interface Membership {
  tenantId: string;
  userId: string;
  role: FleetRole;
  email?: string;
}

export interface FleetDevice {
  tenantId: string;
  deviceId: string;
  name: string;
  uniqueId: string;
  protocol: string;
  retentionDays: number;
  enabled: boolean;
  groupId: string;
  vehicleType: VehicleType;
  /** All optional admin-entered reference fields; unset stays unset, never guessed or computed. */
  model?: string;
  fuelType?: FuelType;
  purchasedOn?: string;
  colour?: string;
  driverId?: string;
  /** Admin-set phone behaviour; the phone uses the domain defaults when these are unset. */
  trackerIntervalSeconds?: number;
  pauseLimitMinutes?: number;
  /** What the driver last reported from the phone app. Unset means never on a shift. */
  dutyStatus?: DutyStatus;
  dutySince?: number;
  pauseReason?: PauseReason;
  pauseUntil?: number;
}

export interface Driver {
  tenantId: string;
  driverId: string;
  name: string;
  phone?: string;
  licenceNumber?: string;
}

/** An update where null clears an optional field and undefined leaves it untouched. */
type Clearable<T> = { [K in keyof T]?: T[K] | null };

export interface DeviceState {
  tenantId: string;
  deviceId: string;
  fixTime?: number;
  lastSeenAt?: number;
  status?: string;
  latitude?: number;
  longitude?: number;
  speedKmh?: number;
  courseDeg?: number;
  attributes?: Record<string, unknown>;
}

export class DynamoFleetStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly coreTable: string,
    private readonly stateTable: string,
    private readonly positionsTable: string,
    private readonly reportTables?: {
      events: string;
      trips: string;
      dailyStats: string;
      commands: string;
    },
  ) {}

  async membership(subject: string): Promise<Membership | undefined> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.coreTable,
        IndexName: 'byCognitoSub',
        KeyConditionExpression: 'cognitoPk = :pk',
        ExpressionAttributeValues: { ':pk': cognitoLookupKey(subject) },
        Limit: 2,
      }),
    );
    if ((result.Count ?? 0) > 1) throw new Error('identity belongs to multiple tenants');
    const item = result.Items?.[0];
    if (!item || item.enabled === false) return undefined;
    const role = String(item.role);
    if (!isRole(role)) throw new Error('membership has an invalid role');
    return {
      tenantId: String(item.tenantId),
      userId: String(item.userId),
      role,
      email: item.email === undefined ? undefined : String(item.email),
    };
  }

  async listDevices(tenantId: string): Promise<Array<FleetDevice & { state?: DeviceState }>> {
    const [devices, states] = await Promise.all([
      this.client.send(
        new QueryCommand({
          TableName: this.coreTable,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
          ExpressionAttributeValues: { ':pk': tenantPartitionKey(tenantId), ':prefix': 'DEVICE#' },
        }),
      ),
      this.client.send(
        new QueryCommand({
          TableName: this.stateTable,
          IndexName: 'byTenant',
          KeyConditionExpression: 'tenantPk = :tenant',
          ExpressionAttributeValues: { ':tenant': tenantId },
        }),
      ),
    ]);
    const stateByDevice = new Map(
      (states.Items ?? []).map((item) => [String(item.deviceId), item as DeviceState]),
    );
    return (devices.Items ?? []).map((item) => {
      const device = toDevice(item);
      return { ...device, state: stateByDevice.get(device.deviceId) };
    });
  }

  async createDevice(
    tenantId: string,
    input: Pick<FleetDevice, 'name' | 'uniqueId' | 'protocol' | 'retentionDays' | 'groupId'> &
      Partial<Pick<FleetDevice, 'vehicleType' | 'model' | 'fuelType' | 'purchasedOn' | 'colour'>>,
  ): Promise<FleetDevice> {
    const deviceId = ulid();
    const device: FleetDevice = {
      ...input,
      vehicleType: input.vehicleType ?? defaultVehicleType,
      tenantId,
      deviceId,
      enabled: true,
    };
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.coreTable,
              Item: { pk: uniqueIdLookupKey(input.uniqueId), sk: 'LOCK', deviceId },
              ConditionExpression: 'attribute_not_exists(pk)',
            },
          },
          {
            Put: {
              TableName: this.coreTable,
              Item: {
                pk: tenantPartitionKey(tenantId),
                sk: `DEVICE#${deviceId}`,
                ...device,
                lookupPk: uniqueIdLookupKey(input.uniqueId),
                lookupSk: `DEVICE#${deviceId}`,
              },
              ConditionExpression: 'attribute_not_exists(pk)',
            },
          },
        ],
      }),
    );
    return device;
  }

  /**
   * Edits a vehicle's own fields or its driver assignment. An optional field set to null is
   * cleared (a null driverId unassigns the driver). Returns undefined when it does not exist.
   */
  async updateDevice(
    tenantId: string,
    deviceId: string,
    changes: Partial<
      Pick<FleetDevice, 'name' | 'vehicleType' | 'trackerIntervalSeconds' | 'pauseLimitMinutes'>
    > &
      Clearable<Pick<FleetDevice, 'model' | 'fuelType' | 'purchasedOn' | 'colour' | 'driverId'>>,
  ): Promise<FleetDevice | undefined> {
    const attributes = await updateItem(
      this.client,
      this.coreTable,
      { pk: tenantPartitionKey(tenantId), sk: `DEVICE#${deviceId}` },
      changes,
    );
    return attributes ? toDevice(attributes) : undefined;
  }

  async listDrivers(tenantId: string): Promise<Driver[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.coreTable,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':pk': tenantPartitionKey(tenantId), ':prefix': 'DRIVER#' },
      }),
    );
    return (result.Items ?? []).map(toDriver);
  }

  async getDriver(tenantId: string, driverId: string): Promise<Driver | undefined> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.coreTable,
        Key: { pk: tenantPartitionKey(tenantId), sk: `DRIVER#${driverId}` },
      }),
    );
    return result.Item ? toDriver(result.Item) : undefined;
  }

  async createDriver(
    tenantId: string,
    input: Pick<Driver, 'name' | 'phone' | 'licenceNumber'>,
  ): Promise<Driver> {
    const driverId = ulid();
    const driver: Driver = { ...input, tenantId, driverId };
    await this.client.send(
      new PutCommand({
        TableName: this.coreTable,
        Item: { pk: tenantPartitionKey(tenantId), sk: `DRIVER#${driverId}`, ...driver },
      }),
    );
    return driver;
  }

  async updateDriver(
    tenantId: string,
    driverId: string,
    changes: Partial<Pick<Driver, 'name'>> & Clearable<Pick<Driver, 'phone' | 'licenceNumber'>>,
  ): Promise<Driver | undefined> {
    const attributes = await updateItem(
      this.client,
      this.coreTable,
      { pk: tenantPartitionKey(tenantId), sk: `DRIVER#${driverId}` },
      changes,
    );
    return attributes ? toDriver(attributes) : undefined;
  }

  /**
   * Returns false when the driver does not exist. Vehicles still pointing at this driver are not
   * touched here; the API unassigns them after the delete succeeds.
   */
  async deleteDriver(tenantId: string, driverId: string): Promise<boolean> {
    const result = await this.client.send(
      new DeleteCommand({
        TableName: this.coreTable,
        Key: { pk: tenantPartitionKey(tenantId), sk: `DRIVER#${driverId}` },
        ReturnValues: 'ALL_OLD',
      }),
    );
    return Boolean(result.Attributes);
  }

  /**
   * Removes a vehicle. Frees its uniqueId for reuse by deleting the reservation lock alongside the
   * device record, atomically. Historical positions/events/trips are left to expire on their own
   * retention TTL rather than deleted here. Returns false when the device does not exist.
   */
  async deleteDevice(tenantId: string, deviceId: string): Promise<boolean> {
    const device = await this.getDevice(tenantId, deviceId);
    if (!device) return false;
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Delete: {
              TableName: this.coreTable,
              Key: { pk: tenantPartitionKey(tenantId), sk: `DEVICE#${deviceId}` },
            },
          },
          {
            Delete: {
              TableName: this.coreTable,
              Key: { pk: uniqueIdLookupKey(device.uniqueId), sk: 'LOCK' },
            },
          },
        ],
      }),
    );
    return true;
  }

  async getDevice(tenantId: string, deviceId: string): Promise<FleetDevice | undefined> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.coreTable,
        Key: { pk: tenantPartitionKey(tenantId), sk: `DEVICE#${deviceId}` },
      }),
    );
    return result.Item ? toDevice(result.Item) : undefined;
  }

  async positions(tenantId: string, deviceId: string, from: number, to: number, limit: number) {
    if (!(await this.getDevice(tenantId, deviceId))) return undefined;
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.positionsTable,
        KeyConditionExpression: 'pk = :pk AND sk BETWEEN :from AND :to',
        ExpressionAttributeValues: {
          ':pk': `TENANT#${tenantId}#DEVICE#${deviceId}`,
          ':from': String(from).padStart(13, '0'),
          ':to': `${String(to).padStart(13, '0')}#~`,
        },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return result.Items ?? [];
  }

  async events(tenantId: string, deviceId: string, from: number, to: number, limit: number) {
    return this.deviceRange(this.requiredTable('events'), tenantId, deviceId, from, to, limit);
  }

  async trips(tenantId: string, deviceId: string, from: number, to: number, limit: number) {
    return this.deviceRange(this.requiredTable('trips'), tenantId, deviceId, from, to, limit);
  }

  async dailyStats(tenantId: string, deviceId: string, fromDay: string, toDay: string) {
    if (!(await this.getDevice(tenantId, deviceId))) return undefined;
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.requiredTable('dailyStats'),
        KeyConditionExpression: 'pk = :pk AND sk BETWEEN :from AND :to',
        ExpressionAttributeValues: {
          ':pk': `TENANT#${tenantId}#DEVICE#${deviceId}`,
          ':from': fromDay,
          ':to': toDay,
        },
        Limit: 366,
      }),
    );
    return result.Items ?? [];
  }

  async createCommand(
    tenantId: string,
    deviceId: string,
    requestedBy: string,
    type: string,
    payload: Record<string, unknown>,
    expiresAtMs: number,
  ) {
    if (!(await this.getDevice(tenantId, deviceId))) return undefined;
    const commandId = ulid();
    const createdAt = Date.now();
    const item = {
      pk: `TENANT#${tenantId}#DEVICE#${deviceId}`,
      sk: `${String(createdAt).padStart(13, '0')}#${commandId}`,
      commandId,
      tenantId,
      deviceId,
      requestedBy,
      type,
      payload,
      status: 'pending',
      createdAt,
      expiresAtMs,
      expiresAt: Math.floor(expiresAtMs / 1000) + 30 * 86_400,
      statusPk: 'PENDING',
      statusSk: `${String(expiresAtMs).padStart(13, '0')}#${deviceId}#${commandId}`,
    };
    await this.client.send(
      new PutCommand({
        TableName: this.requiredTable('commands'),
        Item: item,
        ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
      }),
    );
    return item;
  }

  private async deviceRange(
    tableName: string,
    tenantId: string,
    deviceId: string,
    from: number,
    to: number,
    limit: number,
  ) {
    if (!(await this.getDevice(tenantId, deviceId))) return undefined;
    const result = await this.client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'pk = :pk AND sk BETWEEN :from AND :to',
        ExpressionAttributeValues: {
          ':pk': `TENANT#${tenantId}#DEVICE#${deviceId}`,
          ':from': String(from).padStart(13, '0'),
          ':to': `${String(to).padStart(13, '0')}#~`,
        },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return result.Items ?? [];
  }

  private requiredTable(table: keyof NonNullable<DynamoFleetStore['reportTables']>) {
    const value = this.reportTables?.[table];
    if (!value) throw new Error(`${table} table is not configured`);
    return value;
  }
}

function toDevice(item: Record<string, unknown>): FleetDevice {
  return {
    tenantId: String(item.tenantId),
    deviceId: String(item.deviceId),
    name: String(item.name),
    uniqueId: String(item.uniqueId),
    protocol: String(item.protocol),
    retentionDays: Number(item.retentionDays ?? 90),
    enabled: item.enabled !== false,
    groupId: typeof item.groupId === 'string' ? item.groupId : 'UNGROUPED',
    vehicleType: toVehicleType(item.vehicleType),
    model: typeof item.model === 'string' ? item.model : undefined,
    fuelType: isFuelType(item.fuelType) ? item.fuelType : undefined,
    purchasedOn: typeof item.purchasedOn === 'string' ? item.purchasedOn : undefined,
    colour: typeof item.colour === 'string' ? item.colour : undefined,
    driverId: typeof item.driverId === 'string' ? item.driverId : undefined,
    trackerIntervalSeconds: optionalNumber(item.trackerIntervalSeconds),
    pauseLimitMinutes: optionalNumber(item.pauseLimitMinutes),
    dutyStatus: isOneOf(['off', 'on', 'paused'] as const, item.dutyStatus)
      ? item.dutyStatus
      : undefined,
    dutySince: optionalNumber(item.dutySince),
    pauseReason: isOneOf(pauseReasons, item.pauseReason) ? item.pauseReason : undefined,
    pauseUntil: optionalNumber(item.pauseUntil),
  };
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toDriver(item: Record<string, unknown>): Driver {
  return {
    tenantId: String(item.tenantId),
    driverId: String(item.driverId),
    name: String(item.name),
    phone: typeof item.phone === 'string' ? item.phone : undefined,
    licenceNumber: typeof item.licenceNumber === 'string' ? item.licenceNumber : undefined,
  };
}

function isRole(value: string): value is FleetRole {
  return value === 'admin' || value === 'dispatcher' || value === 'viewer';
}

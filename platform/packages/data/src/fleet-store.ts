import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { cognitoLookupKey, tenantPartitionKey, uniqueIdLookupKey } from './keys';

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
}

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
    input: Pick<FleetDevice, 'name' | 'uniqueId' | 'protocol' | 'retentionDays' | 'groupId'>,
  ): Promise<FleetDevice> {
    const deviceId = ulid();
    const device: FleetDevice = { ...input, tenantId, deviceId, enabled: true };
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
  };
}

function isRole(value: string): value is FleetRole {
  return value === 'admin' || value === 'dispatcher' || value === 'viewer';
}

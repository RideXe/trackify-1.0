import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import type { GeofenceRule } from '@trackify/fleet';
import { ulid } from 'ulid';
import type { FleetRole } from './fleet-store';
import { cognitoLookupKey, tenantPartitionKey } from './keys';
import { toContact } from './notification-store';
import { updateItem } from './update-item';

export type GeofenceShape = GeofenceRule['shape'];

/** A fleet branch or depot. Vehicles belong to at most one; users can be limited to several. */
export interface Group {
  tenantId: string;
  groupId: string;
  name: string;
  description?: string;
}

/** Shape matches what fleet processing reads, so a saved geofence applies to the next fix. */
export interface Geofence {
  tenantId: string;
  geofenceId: string;
  name: string;
  description?: string;
  shape: GeofenceShape;
}

export interface FleetUser {
  tenantId: string;
  userId: string;
  email?: string;
  role: FleetRole;
  enabled: boolean;
  /** Empty means the whole fleet. Admins always see the whole fleet. */
  groupIds: string[];
  /** The Cognito account behind this user. */
  subject?: string;
  phone?: string;
  telegramChatId?: string;
  pushoverUserKey?: string;
}

/** Derives a position attribute from others with an expression (see @trackify/fleet). */
export interface ComputedAttributeRecord {
  tenantId: string;
  attributeId: string;
  description?: string;
  attribute: string;
  expression: string;
  type: 'number' | 'boolean' | 'string';
  /** Lower runs first, so later expressions can use earlier results. */
  order: number;
  deviceIds: string[];
  groupIds: string[];
}

/** A service reminder every `period` from `start` of odometer, engine hours or calendar time. */
export interface Maintenance {
  tenantId: string;
  maintenanceId: string;
  name: string;
  type: 'odometerM' | 'engineHoursS' | 'fixTime';
  start: number;
  period: number;
  deviceIds: string[];
  groupIds: string[];
}

export type ComputedAttributeInput = Omit<ComputedAttributeRecord, 'tenantId' | 'attributeId'>;
export type MaintenanceInput = Omit<Maintenance, 'tenantId' | 'maintenanceId'>;

type Clearable<T> = { [K in keyof T]?: T[K] | null };

/** Tenant configuration managed by fleet administrators: groups, geofences and users. */
export class DynamoAdminStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly coreTable: string,
  ) {}

  async listGroups(tenantId: string): Promise<Group[]> {
    return (await this.list(tenantId, 'GROUP#')).map(toGroup);
  }

  async getGroup(tenantId: string, groupId: string): Promise<Group | undefined> {
    const item = await this.get(tenantId, `GROUP#${groupId}`);
    return item ? toGroup(item) : undefined;
  }

  async createGroup(tenantId: string, input: Pick<Group, 'name' | 'description'>): Promise<Group> {
    const group: Group = { ...input, tenantId, groupId: ulid() };
    await this.put(`GROUP#${group.groupId}`, group);
    return group;
  }

  async updateGroup(
    tenantId: string,
    groupId: string,
    changes: Partial<Pick<Group, 'name'>> & Clearable<Pick<Group, 'description'>>,
  ): Promise<Group | undefined> {
    const item = await this.update(tenantId, `GROUP#${groupId}`, changes);
    return item ? toGroup(item) : undefined;
  }

  /** Vehicles and users still pointing at the group are released by the API afterwards. */
  async deleteGroup(tenantId: string, groupId: string): Promise<boolean> {
    return this.remove(tenantId, `GROUP#${groupId}`);
  }

  async listGeofences(tenantId: string): Promise<Geofence[]> {
    return (await this.list(tenantId, 'GEOFENCE#')).flatMap((item) => toGeofence(item) ?? []);
  }

  async getGeofence(tenantId: string, geofenceId: string): Promise<Geofence | undefined> {
    const item = await this.get(tenantId, `GEOFENCE#${geofenceId}`);
    return item ? toGeofence(item) : undefined;
  }

  async createGeofence(
    tenantId: string,
    input: Pick<Geofence, 'name' | 'description' | 'shape'>,
  ): Promise<Geofence> {
    const geofence: Geofence = { ...input, tenantId, geofenceId: ulid() };
    await this.put(`GEOFENCE#${geofence.geofenceId}`, geofence);
    return geofence;
  }

  async updateGeofence(
    tenantId: string,
    geofenceId: string,
    changes: Partial<Pick<Geofence, 'name' | 'shape'>> & Clearable<Pick<Geofence, 'description'>>,
  ): Promise<Geofence | undefined> {
    const item = await this.update(tenantId, `GEOFENCE#${geofenceId}`, changes);
    return item ? toGeofence(item) : undefined;
  }

  /** Vehicles inside it drop it on their next report without an exit event (see @trackify/fleet). */
  async deleteGeofence(tenantId: string, geofenceId: string): Promise<boolean> {
    return this.remove(tenantId, `GEOFENCE#${geofenceId}`);
  }

  async listUsers(tenantId: string): Promise<FleetUser[]> {
    return (await this.list(tenantId, 'USER#')).map(toUser);
  }

  async getUser(tenantId: string, userId: string): Promise<FleetUser | undefined> {
    const item = await this.get(tenantId, `USER#${userId}`);
    return item ? toUser(item) : undefined;
  }

  /** One fleet user per sign-in account; the byCognitoSub index resolves the tenant at login. */
  async createUser(
    tenantId: string,
    input: Pick<FleetUser, 'email' | 'role' | 'groupIds'> & { subject: string },
  ): Promise<FleetUser> {
    const { subject, ...fields } = input;
    const user: FleetUser = { ...fields, tenantId, userId: ulid(), enabled: true, subject };
    await this.put(`USER#${user.userId}`, {
      ...fields,
      tenantId,
      userId: user.userId,
      enabled: true,
      cognitoSubject: subject,
      cognitoPk: cognitoLookupKey(subject),
      cognitoSk: tenantPartitionKey(tenantId),
    });
    return user;
  }

  /** Returns the removed user's Cognito subject, or undefined when there was no such user. */
  async deleteUser(tenantId: string, userId: string): Promise<{ subject?: string } | undefined> {
    const result = await this.client.send(
      new DeleteCommand({
        TableName: this.coreTable,
        Key: { pk: tenantPartitionKey(tenantId), sk: `USER#${userId}` },
        ReturnValues: 'ALL_OLD',
      }),
    );
    if (!result.Attributes) return undefined;
    return { subject: subjectOf(result.Attributes) };
  }

  async updateUser(
    tenantId: string,
    userId: string,
    changes: Partial<Pick<FleetUser, 'role' | 'enabled' | 'groupIds'>>,
  ): Promise<FleetUser | undefined> {
    const item = await this.update(tenantId, `USER#${userId}`, changes);
    return item ? toUser(item) : undefined;
  }

  async listComputed(tenantId: string): Promise<ComputedAttributeRecord[]> {
    return (await this.list(tenantId, 'COMPUTED#'))
      .map((item) => toComputed(item))
      .sort((a, b) => a.order - b.order);
  }

  async createComputed(
    tenantId: string,
    input: ComputedAttributeInput,
  ): Promise<ComputedAttributeRecord> {
    const record: ComputedAttributeRecord = { ...input, tenantId, attributeId: ulid() };
    await this.put(`COMPUTED#${record.attributeId}`, record);
    return record;
  }

  async updateComputed(
    tenantId: string,
    attributeId: string,
    changes: Partial<ComputedAttributeInput>,
  ): Promise<ComputedAttributeRecord | undefined> {
    const item = await this.update(tenantId, `COMPUTED#${attributeId}`, changes);
    return item ? toComputed(item) : undefined;
  }

  async deleteComputed(tenantId: string, attributeId: string) {
    return this.remove(tenantId, `COMPUTED#${attributeId}`);
  }

  async listMaintenances(tenantId: string): Promise<Maintenance[]> {
    return (await this.list(tenantId, 'MAINT#')).map(toMaintenance);
  }

  async createMaintenance(tenantId: string, input: MaintenanceInput): Promise<Maintenance> {
    const record: Maintenance = { ...input, tenantId, maintenanceId: ulid() };
    await this.put(`MAINT#${record.maintenanceId}`, record);
    return record;
  }

  async updateMaintenance(
    tenantId: string,
    maintenanceId: string,
    changes: Partial<MaintenanceInput>,
  ): Promise<Maintenance | undefined> {
    const item = await this.update(tenantId, `MAINT#${maintenanceId}`, changes);
    return item ? toMaintenance(item) : undefined;
  }

  async deleteMaintenance(tenantId: string, maintenanceId: string) {
    return this.remove(tenantId, `MAINT#${maintenanceId}`);
  }

  private async list(tenantId: string, prefix: string) {
    const items: Record<string, unknown>[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.coreTable,
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

  private async get(tenantId: string, sk: string) {
    const result = await this.client.send(
      new GetCommand({ TableName: this.coreTable, Key: { pk: tenantPartitionKey(tenantId), sk } }),
    );
    return result.Item;
  }

  private async put<T extends { tenantId: string }>(sk: string, item: T) {
    await this.client.send(
      new PutCommand({
        TableName: this.coreTable,
        Item: { pk: tenantPartitionKey(item.tenantId), sk, ...item },
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
  }

  private update(tenantId: string, sk: string, changes: Record<string, unknown>) {
    return updateItem(
      this.client,
      this.coreTable,
      { pk: tenantPartitionKey(tenantId), sk },
      changes,
    );
  }

  private async remove(tenantId: string, sk: string) {
    const result = await this.client.send(
      new DeleteCommand({
        TableName: this.coreTable,
        Key: { pk: tenantPartitionKey(tenantId), sk },
        ReturnValues: 'ALL_OLD',
      }),
    );
    return Boolean(result.Attributes);
  }
}

function toGroup(item: Record<string, unknown>): Group {
  return {
    tenantId: String(item.tenantId),
    groupId: String(item.groupId),
    name: String(item.name),
    description: typeof item.description === 'string' ? item.description : undefined,
  };
}

function toGeofence(item: Record<string, unknown>): Geofence | undefined {
  const shape = item.shape as GeofenceShape | undefined;
  if (shape?.type !== 'circle' && shape?.type !== 'polygon') return undefined;
  return {
    tenantId: String(item.tenantId),
    geofenceId: String(item.geofenceId),
    name: String(item.name),
    description: typeof item.description === 'string' ? item.description : undefined,
    shape,
  };
}

/** Older users (made by the bootstrap tool) only carry the subject inside their index key. */
function subjectOf(item: Record<string, unknown>) {
  if (typeof item.cognitoSubject === 'string') return item.cognitoSubject;
  return typeof item.cognitoPk === 'string' ? item.cognitoPk.replace(/^COGNITO#/, '') : undefined;
}

function toUser(item: Record<string, unknown>): FleetUser {
  return {
    subject: subjectOf(item),
    tenantId: String(item.tenantId),
    userId: String(item.userId),
    email: typeof item.email === 'string' ? item.email : undefined,
    role: item.role as FleetRole,
    enabled: item.enabled !== false,
    groupIds: Array.isArray(item.groupIds) ? item.groupIds.map(String) : [],
    ...toContact(item),
  };
}

function idList(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function toComputed(item: Record<string, unknown>): ComputedAttributeRecord {
  return {
    tenantId: String(item.tenantId),
    attributeId: String(item.attributeId),
    description: typeof item.description === 'string' ? item.description : undefined,
    attribute: String(item.attribute),
    expression: String(item.expression),
    type: item.type === 'boolean' || item.type === 'string' ? item.type : 'number',
    order: typeof item.order === 'number' ? item.order : 0,
    deviceIds: idList(item.deviceIds),
    groupIds: idList(item.groupIds),
  };
}

function toMaintenance(item: Record<string, unknown>): Maintenance {
  return {
    tenantId: String(item.tenantId),
    maintenanceId: String(item.maintenanceId),
    name: String(item.name),
    type: item.type as Maintenance['type'],
    start: Number(item.start),
    period: Number(item.period),
    deviceIds: idList(item.deviceIds),
    groupIds: idList(item.groupIds),
  };
}

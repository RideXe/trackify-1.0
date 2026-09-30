import {
  GetCommand,
  PutCommand,
  QueryCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import type {
  ActivityEntry,
  ActivityType,
  AlertSeverity,
  DutyStatus,
  IssueKind,
  PauseReason,
  WarningKind,
} from '@trackify/domain';
import { encodeTime, ulid } from 'ulid';
import { devicePartitionKey, tenantPartitionKey } from './keys';
import { updateItem } from './update-item';

export interface Organisation {
  tenantId: string;
  name: string;
  /** Who drivers reach with the "Call dispatcher" button. */
  dispatcherPhone?: string;
}

export interface FleetAlert {
  alertId: string;
  tenantId: string;
  deviceId: string;
  deviceName: string;
  entryId: string;
  type: ActivityType;
  kind?: IssueKind | WarningKind;
  severity: AlertSeverity;
  status: 'open' | 'acknowledged';
  createdAt: number;
  latitude?: number;
  longitude?: number;
  note?: string;
  acknowledgedAt?: number;
  acknowledgedBy?: string;
}

export interface DutyChange {
  dutyStatus: DutyStatus;
  dutySince: number;
  /** null clears it when the driver resumes or ends the shift. */
  pauseReason: PauseReason | null;
  pauseUntil: number | null;
}

/**
 * Driver activity (per vehicle), the alerts it raises (per tenant) and organisation settings.
 * Entries and alerts are keyed by ULID, so key order is arrival order.
 */
export class DynamoActivityStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly coreTable: string,
  ) {}

  async organisation(tenantId: string): Promise<Organisation | undefined> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.coreTable,
        Key: { pk: tenantPartitionKey(tenantId), sk: 'META' },
      }),
    );
    return result.Item ? toOrganisation(result.Item) : undefined;
  }

  async updateOrganisation(
    tenantId: string,
    changes: { name?: string; dispatcherPhone?: string | null },
  ): Promise<Organisation | undefined> {
    const attributes = await updateItem(
      this.client,
      this.coreTable,
      { pk: tenantPartitionKey(tenantId), sk: 'META' },
      changes,
    );
    return attributes ? toOrganisation(attributes) : undefined;
  }

  async append(
    tenantId: string,
    entry: Omit<ActivityEntry, 'entryId' | 'receivedAt'>,
    now = Date.now(),
  ): Promise<ActivityEntry> {
    const stored: ActivityEntry = { ...entry, entryId: ulid(now), receivedAt: now };
    await this.client.send(
      new PutCommand({
        TableName: this.coreTable,
        Item: {
          pk: devicePartitionKey(tenantId, entry.deviceId),
          sk: `LOG#${stored.entryId}`,
          tenantId,
          ...stored,
        },
      }),
    );
    return stored;
  }

  /** Newest first, by when the server received them. */
  async list(
    tenantId: string,
    deviceId: string,
    from: number,
    to: number,
    limit: number,
    type?: ActivityType,
  ): Promise<ActivityEntry[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.coreTable,
        KeyConditionExpression: 'pk = :pk AND sk BETWEEN :from AND :to',
        ExpressionAttributeValues: {
          ':pk': devicePartitionKey(tenantId, deviceId),
          ':from': `LOG#${encodeTime(Math.max(0, from), 10)}`,
          ':to': `LOG#${encodeTime(Math.max(0, to), 10)}~`,
          ...(type ? { ':type': type } : {}),
        },
        ...(type
          ? { FilterExpression: '#type = :type', ExpressionAttributeNames: { '#type': 'type' } }
          : { Limit: limit }),
        ScanIndexForward: false,
      }),
    );
    return (result.Items ?? []).slice(0, limit).map(toEntry);
  }

  /** Returns false when the vehicle no longer exists. */
  async setDuty(tenantId: string, deviceId: string, duty: DutyChange): Promise<boolean> {
    const attributes = await updateItem(
      this.client,
      this.coreTable,
      { pk: tenantPartitionKey(tenantId), sk: `DEVICE#${deviceId}` },
      { ...duty },
    );
    return Boolean(attributes);
  }

  async createAlert(alert: Omit<FleetAlert, 'alertId' | 'status'>): Promise<FleetAlert> {
    const stored: FleetAlert = { ...alert, alertId: ulid(alert.createdAt), status: 'open' };
    await this.client.send(
      new PutCommand({
        TableName: this.coreTable,
        Item: { pk: tenantPartitionKey(alert.tenantId), sk: `ALERT#${stored.alertId}`, ...stored },
      }),
    );
    return stored;
  }

  /** The most recent alerts, newest first, open and acknowledged alike. */
  async listAlerts(tenantId: string, limit = 100): Promise<FleetAlert[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.coreTable,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':pk': tenantPartitionKey(tenantId), ':prefix': 'ALERT#' },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (result.Items ?? []).map((item) => item as FleetAlert);
  }

  async acknowledgeAlert(
    tenantId: string,
    alertId: string,
    by: string,
    now = Date.now(),
  ): Promise<FleetAlert | undefined> {
    const attributes = await updateItem(
      this.client,
      this.coreTable,
      { pk: tenantPartitionKey(tenantId), sk: `ALERT#${alertId}` },
      { status: 'acknowledged', acknowledgedAt: now, acknowledgedBy: by },
    );
    return attributes as FleetAlert | undefined;
  }
}

function toOrganisation(item: Record<string, unknown>): Organisation {
  return {
    tenantId: String(item.tenantId),
    name: typeof item.name === 'string' ? item.name : '',
    dispatcherPhone: typeof item.dispatcherPhone === 'string' ? item.dispatcherPhone : undefined,
  };
}

function toEntry(item: Record<string, unknown>): ActivityEntry {
  const entry = { ...item };
  delete entry.pk;
  delete entry.sk;
  delete entry.tenantId;
  return entry as unknown as ActivityEntry;
}

import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { tenantPartitionKey } from './keys';
import { updateItem } from './update-item';

/** A report emailed on a schedule, e.g. yesterday's trips every morning. */
export interface ScheduledReport {
  tenantId: string;
  reportId: string;
  name: string;
  kind: string;
  schedule: 'daily' | 'weekly' | 'monthly';
  enabled: boolean;
  /** Which vehicles. Both empty means the whole fleet. */
  deviceIds: string[];
  groupIds: string[];
  /** Who receives it. Empty means every active administrator. */
  userIds: string[];
  nextRunAt: number;
  lastRunAt?: number;
}

export type ScheduledReportInput = Omit<ScheduledReport, 'tenantId' | 'reportId' | 'lastRunAt'>;

const DUE = 'REPORT';

/**
 * Enabled reports also carry dueKey/dueAt for the sparse byDueTime index, so the hourly sender
 * reads only reports that are due, never every tenant.
 */
export class DynamoReportStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly coreTable: string,
  ) {}

  async list(tenantId: string): Promise<ScheduledReport[]> {
    const items: Record<string, unknown>[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.coreTable,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
          ExpressionAttributeValues: { ':pk': tenantPartitionKey(tenantId), ':prefix': 'REPORT#' },
          ExclusiveStartKey: startKey,
        }),
      );
      items.push(...(result.Items ?? []));
      startKey = result.LastEvaluatedKey;
    } while (startKey);
    return items.map(toReport);
  }

  async get(tenantId: string, reportId: string): Promise<ScheduledReport | undefined> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.coreTable,
        Key: { pk: tenantPartitionKey(tenantId), sk: `REPORT#${reportId}` },
      }),
    );
    return result.Item ? toReport(result.Item) : undefined;
  }

  async create(tenantId: string, input: ScheduledReportInput): Promise<ScheduledReport> {
    const report: ScheduledReport = { ...input, tenantId, reportId: ulid() };
    await this.client.send(
      new PutCommand({
        TableName: this.coreTable,
        Item: {
          pk: tenantPartitionKey(tenantId),
          sk: `REPORT#${report.reportId}`,
          ...report,
          ...dueIndex(report),
        },
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
    return report;
  }

  async update(
    tenantId: string,
    reportId: string,
    changes: Partial<ScheduledReportInput> & { lastRunAt?: number },
  ): Promise<ScheduledReport | undefined> {
    const current = await this.get(tenantId, reportId);
    if (!current) return undefined;
    const next = { ...current, ...changes };
    const item = await updateItem(
      this.client,
      this.coreTable,
      { pk: tenantPartitionKey(tenantId), sk: `REPORT#${reportId}` },
      { ...changes, ...(next.enabled ? dueIndex(next) : { dueKey: null, dueAt: null }) },
    );
    return item ? toReport(item) : undefined;
  }

  async remove(tenantId: string, reportId: string): Promise<boolean> {
    const result = await this.client.send(
      new DeleteCommand({
        TableName: this.coreTable,
        Key: { pk: tenantPartitionKey(tenantId), sk: `REPORT#${reportId}` },
        ReturnValues: 'ALL_OLD',
      }),
    );
    return Boolean(result.Attributes);
  }

  /** Keys of enabled reports due at or before `now`, across all tenants. */
  async due(now: number, limit = 200): Promise<Array<{ tenantId: string; reportId: string }>> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.coreTable,
        IndexName: 'byDueTime',
        KeyConditionExpression: 'dueKey = :due AND dueAt <= :now',
        ExpressionAttributeValues: { ':due': DUE, ':now': now },
        Limit: limit,
      }),
    );
    return (result.Items ?? []).flatMap((item) => {
      const tenantId = /^TENANT#(.+)$/.exec(String(item.pk))?.[1];
      const reportId = /^REPORT#(.+)$/.exec(String(item.sk))?.[1];
      return tenantId && reportId ? [{ tenantId, reportId }] : [];
    });
  }
}

function dueIndex(report: Pick<ScheduledReport, 'enabled' | 'nextRunAt'>) {
  return report.enabled ? { dueKey: DUE, dueAt: report.nextRunAt } : {};
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function toReport(item: Record<string, unknown>): ScheduledReport {
  return {
    tenantId: String(item.tenantId),
    reportId: String(item.reportId),
    name: String(item.name),
    kind: String(item.kind),
    schedule: item.schedule as ScheduledReport['schedule'],
    enabled: item.enabled !== false,
    deviceIds: strings(item.deviceIds),
    groupIds: strings(item.groupIds),
    userIds: strings(item.userIds),
    nextRunAt: Number(item.nextRunAt),
    lastRunAt: typeof item.lastRunAt === 'number' ? item.lastRunAt : undefined,
  };
}

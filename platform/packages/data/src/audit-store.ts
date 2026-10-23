import { PutCommand, QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { encodeTime, ulid } from 'ulid';
import { tenantPartitionKey } from './keys';

/** One change made through the API: who, what and when. Request bodies are never kept. */
export interface AuditEntry {
  auditId: string;
  at: number;
  userId: string;
  email?: string;
  method: string;
  path: string;
  status: number;
}

const RETENTION_DAYS = 365;

export class DynamoAuditStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly coreTable: string,
  ) {}

  async record(tenantId: string, entry: Omit<AuditEntry, 'auditId'>): Promise<void> {
    const auditId = ulid(entry.at);
    await this.client.send(
      new PutCommand({
        TableName: this.coreTable,
        Item: {
          pk: tenantPartitionKey(tenantId),
          sk: `AUDIT#${auditId}`,
          auditId,
          ...entry,
          expiresAt: Math.floor(entry.at / 1000) + RETENTION_DAYS * 86_400,
        },
      }),
    );
  }

  /** Newest first. ULIDs sort by time, so a time range is a key range. */
  async list(tenantId: string, from: number, to: number, limit = 500): Promise<AuditEntry[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.coreTable,
        KeyConditionExpression: 'pk = :pk AND sk BETWEEN :from AND :to',
        ExpressionAttributeValues: {
          ':pk': tenantPartitionKey(tenantId),
          ':from': `AUDIT#${encodeTime(from, 10)}`,
          ':to': `AUDIT#${encodeTime(to, 10)}~`,
        },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (result.Items ?? []).map((item) => ({
      auditId: String(item.auditId),
      at: Number(item.at),
      userId: String(item.userId),
      email: typeof item.email === 'string' ? item.email : undefined,
      method: String(item.method),
      path: String(item.path),
      status: Number(item.status),
    }));
  }
}

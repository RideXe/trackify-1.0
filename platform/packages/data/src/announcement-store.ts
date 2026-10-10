import {
  GetCommand,
  PutCommand,
  QueryCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import type { NotificationChannel } from '@trackify/domain';
import { ulid } from 'ulid';
import { tenantPartitionKey } from './keys';

/** A message from administrators to every user of the fleet. */
export interface Announcement {
  tenantId: string;
  announcementId: string;
  title: string;
  message: string;
  channels: NotificationChannel[];
  createdBy: string;
  createdAt: number;
  expiresAtMs: number;
}

export class DynamoAnnouncementStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly coreTable: string,
  ) {}

  async create(input: Omit<Announcement, 'announcementId' | 'createdAt'>, now = Date.now()) {
    const announcement: Announcement = { ...input, announcementId: ulid(now), createdAt: now };
    await this.client.send(
      new PutCommand({
        TableName: this.coreTable,
        Item: {
          pk: tenantPartitionKey(input.tenantId),
          sk: `ANNOUNCE#${announcement.announcementId}`,
          ...announcement,
          expiresAt: Math.floor(input.expiresAtMs / 1000),
        },
      }),
    );
    return announcement;
  }

  async get(tenantId: string, announcementId: string): Promise<Announcement | undefined> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.coreTable,
        Key: { pk: tenantPartitionKey(tenantId), sk: `ANNOUNCE#${announcementId}` },
      }),
    );
    return result.Item as Announcement | undefined;
  }

  /** Current announcements, newest first. */
  async active(tenantId: string, now = Date.now()): Promise<Announcement[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.coreTable,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':pk': tenantPartitionKey(tenantId), ':prefix': 'ANNOUNCE#' },
        ScanIndexForward: false,
        Limit: 50,
      }),
    );
    return ((result.Items ?? []) as Announcement[])
      .filter((item) => item.expiresAtMs > now)
      .map(
        ({
          tenantId: owner,
          announcementId,
          title,
          message,
          channels,
          createdBy,
          createdAt,
          expiresAtMs,
        }) => ({
          tenantId: owner,
          announcementId,
          title,
          message,
          channels,
          createdBy,
          createdAt,
          expiresAtMs,
        }),
      );
  }
}

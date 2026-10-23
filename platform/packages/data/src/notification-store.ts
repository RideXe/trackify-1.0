import { createHash } from 'node:crypto';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import type { AlertRule, Calendar } from '@trackify/domain';
import { ulid } from 'ulid';
import { tenantPartitionKey } from './keys';
import { updateItem } from './update-item';

export type PushPlatform = 'android' | 'ios' | 'web';

/** One FCM registration token of one user's phone or browser. */
export interface PushToken {
  tokenId: string;
  userId: string;
  token: string;
  platform: PushPlatform;
  createdAt: number;
}

/** Where a user wants to be reached, beyond the email they sign in with. */
export interface UserContact {
  phone?: string;
  telegramChatId?: string;
  pushoverUserKey?: string;
}

type Clearable<T> = { [K in keyof T]?: T[K] | null };

export type RuleInput = Omit<AlertRule, 'tenantId' | 'ruleId'>;
export type CalendarInput = Omit<Calendar, 'tenantId' | 'calendarId'>;

/** Alert rules, calendars, push registrations and user contact details. */
export class DynamoNotificationStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly coreTable: string,
  ) {}

  async listRules(tenantId: string): Promise<AlertRule[]> {
    return (await this.list(tenantId, 'RULE#')).map(toRule);
  }

  async createRule(tenantId: string, input: RuleInput): Promise<AlertRule> {
    const rule: AlertRule = { ...input, tenantId, ruleId: ulid() };
    await this.put(tenantId, `RULE#${rule.ruleId}`, rule);
    return rule;
  }

  async updateRule(
    tenantId: string,
    ruleId: string,
    changes: Partial<Omit<RuleInput, 'calendarId' | 'command'>> &
      Clearable<Pick<RuleInput, 'calendarId' | 'command'>>,
  ): Promise<AlertRule | undefined> {
    const item = await this.update(tenantId, `RULE#${ruleId}`, changes);
    return item ? toRule(item) : undefined;
  }

  async deleteRule(tenantId: string, ruleId: string) {
    return this.remove(tenantId, `RULE#${ruleId}`);
  }

  async listCalendars(tenantId: string): Promise<Calendar[]> {
    return (await this.list(tenantId, 'CALENDAR#')).map(toCalendar);
  }

  async getCalendar(tenantId: string, calendarId: string): Promise<Calendar | undefined> {
    const item = await this.get(tenantId, `CALENDAR#${calendarId}`);
    return item ? toCalendar(item) : undefined;
  }

  async createCalendar(tenantId: string, input: CalendarInput): Promise<Calendar> {
    const calendar: Calendar = { ...input, tenantId, calendarId: ulid() };
    await this.put(tenantId, `CALENDAR#${calendar.calendarId}`, calendar);
    return calendar;
  }

  async updateCalendar(
    tenantId: string,
    calendarId: string,
    changes: Partial<CalendarInput>,
  ): Promise<Calendar | undefined> {
    const item = await this.update(tenantId, `CALENDAR#${calendarId}`, changes);
    return item ? toCalendar(item) : undefined;
  }

  async deleteCalendar(tenantId: string, calendarId: string) {
    return this.remove(tenantId, `CALENDAR#${calendarId}`);
  }

  /** Registering the same token again just refreshes it; ids are derived from the token. */
  async savePushToken(
    tenantId: string,
    userId: string,
    token: string,
    platform: PushPlatform,
    now = Date.now(),
  ): Promise<PushToken> {
    const pushToken: PushToken = {
      tokenId: tokenId(token),
      userId,
      token,
      platform,
      createdAt: now,
    };
    await this.client.send(
      new PutCommand({
        TableName: this.coreTable,
        Item: {
          pk: tenantPartitionKey(tenantId),
          sk: `PUSH#${userId}#${pushToken.tokenId}`,
          tenantId,
          ...pushToken,
        },
      }),
    );
    return pushToken;
  }

  async listPushTokens(tenantId: string, userId: string): Promise<PushToken[]> {
    return (await this.list(tenantId, `PUSH#${userId}#`)).map(toPushToken);
  }

  async deletePushToken(tenantId: string, userId: string, id: string) {
    return this.remove(tenantId, `PUSH#${userId}#${id}`);
  }

  async updateContact(
    tenantId: string,
    userId: string,
    changes: Clearable<UserContact>,
  ): Promise<UserContact | undefined> {
    const item = await this.update(tenantId, `USER#${userId}`, changes);
    return item ? toContact(item) : undefined;
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

  private async put<T extends object>(tenantId: string, sk: string, item: T) {
    await this.client.send(
      new PutCommand({
        TableName: this.coreTable,
        Item: { pk: tenantPartitionKey(tenantId), sk, ...item },
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

/** Short, stable and not the token itself, so ids can appear in URLs and logs. */
export function tokenId(token: string) {
  return createHash('sha256').update(token).digest('hex').slice(0, 32);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function toRule(item: Record<string, unknown>): AlertRule {
  const command = item.command as AlertRule['command'] | undefined;
  return {
    tenantId: String(item.tenantId),
    ruleId: String(item.ruleId),
    name: String(item.name),
    enabled: item.enabled !== false,
    eventTypes: strings(item.eventTypes) as AlertRule['eventTypes'],
    alarms: strings(item.alarms) as AlertRule['alarms'],
    deviceIds: strings(item.deviceIds),
    groupIds: strings(item.groupIds),
    channels: strings(item.channels) as AlertRule['channels'],
    userIds: strings(item.userIds),
    calendarId: typeof item.calendarId === 'string' ? item.calendarId : undefined,
    command: command && typeof command.type === 'string' ? command : undefined,
  };
}

function toCalendar(item: Record<string, unknown>): Calendar {
  return {
    tenantId: String(item.tenantId),
    calendarId: String(item.calendarId),
    name: String(item.name),
    timeZone: String(item.timeZone),
    windows: Array.isArray(item.windows) ? (item.windows as Calendar['windows']) : [],
  };
}

function toPushToken(item: Record<string, unknown>): PushToken {
  return {
    tokenId: String(item.tokenId),
    userId: String(item.userId),
    token: String(item.token),
    platform: item.platform as PushPlatform,
    createdAt: Number(item.createdAt),
  };
}

export function toContact(item: Record<string, unknown>): UserContact {
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
  return {
    phone: text(item.phone),
    telegramChatId: text(item.telegramChatId),
    pushoverUserKey: text(item.pushoverUserKey),
  };
}

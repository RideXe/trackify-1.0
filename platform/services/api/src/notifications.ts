import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import type {
  CalendarInput,
  FleetUser,
  Group,
  Membership,
  PushPlatform,
  PushToken,
  RuleInput,
  UserContact,
} from '@trackify/data';
import {
  alarmTypeSchema,
  eventTypeSchema,
  isNotificationChannel,
  isTimeOfDay,
  isTimeZone,
  type AlertRule,
  type Calendar,
} from '@trackify/domain';
import { clearable, InputError, isRecord, jsonObject, response, text } from './http';

const MAX_RULES = 200;
const MAX_LIST = 500;
const MAX_WINDOWS = 21;
export const RULE_COMMANDS = ['engineStop', 'engineResume', 'custom'];

export interface NotificationStore {
  listRules(tenantId: string): Promise<AlertRule[]>;
  createRule(tenantId: string, input: RuleInput): Promise<AlertRule>;
  updateRule(
    tenantId: string,
    ruleId: string,
    changes: Record<string, unknown>,
  ): Promise<AlertRule | undefined>;
  deleteRule(tenantId: string, ruleId: string): Promise<boolean>;
  listCalendars(tenantId: string): Promise<Calendar[]>;
  getCalendar(tenantId: string, calendarId: string): Promise<Calendar | undefined>;
  createCalendar(tenantId: string, input: CalendarInput): Promise<Calendar>;
  updateCalendar(
    tenantId: string,
    calendarId: string,
    changes: Partial<CalendarInput>,
  ): Promise<Calendar | undefined>;
  deleteCalendar(tenantId: string, calendarId: string): Promise<boolean>;
  savePushToken(
    tenantId: string,
    userId: string,
    token: string,
    platform: PushPlatform,
  ): Promise<PushToken>;
  listPushTokens(tenantId: string, userId: string): Promise<PushToken[]>;
  deletePushToken(tenantId: string, userId: string, tokenId: string): Promise<boolean>;
  updateContact(
    tenantId: string,
    userId: string,
    changes: { [K in keyof UserContact]?: string | null },
  ): Promise<UserContact | undefined>;
}

/** What rule validation checks references against. */
export interface FleetDirectory {
  listDevices(tenantId: string): Promise<Array<{ deviceId: string }>>;
  listGroups(tenantId: string): Promise<Group[]>;
  listUsers(tenantId: string): Promise<FleetUser[]>;
}

/** Alert rules, calendars, and each user's own contact details and push registrations. */
export function createNotificationRoutes(store: NotificationStore, fleet: FleetDirectory) {
  return async (
    event: APIGatewayProxyEventV2WithJWTAuthorizer,
    membership: Membership,
  ): Promise<ReturnType<typeof response> | undefined> => {
    const method = event.requestContext.http.method;
    const path = event.rawPath;
    const { tenantId, userId } = membership;
    const isAdmin = membership.role === 'admin';
    const adminRequired = () => response(403, { message: 'admin role required' });

    if (path === '/me' && method === 'PATCH') {
      const contact = await store.updateContact(tenantId, userId, parseContact(event.body));
      return contact ? response(200, contact) : response(404, { message: 'user not found' });
    }
    if (path === '/me/push-tokens') {
      if (method === 'GET')
        return response(200, { items: await store.listPushTokens(tenantId, userId) });
      if (method === 'POST') {
        const value = jsonObject(event.body);
        const token = text(value.token, 'token', 20, 4_096);
        if (value.platform !== 'android' && value.platform !== 'ios' && value.platform !== 'web')
          throw new InputError('platform must be android, ios or web');
        return response(201, await store.savePushToken(tenantId, userId, token, value.platform));
      }
    }
    const tokenMatch = path.match(/^\/me\/push-tokens\/([a-f0-9]{32})$/);
    if (tokenMatch?.[1] && method === 'DELETE') {
      return (await store.deletePushToken(tenantId, userId, tokenMatch[1]))
        ? response(204, undefined)
        : response(404, { message: 'push token not found' });
    }

    if (path === '/calendars') {
      if (method === 'GET') return response(200, { items: await store.listCalendars(tenantId) });
      if (method === 'POST') {
        if (!isAdmin) return adminRequired();
        return response(201, await store.createCalendar(tenantId, parseCalendar(event.body)));
      }
    }
    const calendarMatch = path.match(/^\/calendars\/([^/]+)$/);
    if (calendarMatch?.[1]) {
      if (!isAdmin) return adminRequired();
      const calendarId = calendarMatch[1];
      if (method === 'PATCH') {
        const calendar = await store.updateCalendar(
          tenantId,
          calendarId,
          parseCalendar(event.body, true),
        );
        return calendar
          ? response(200, calendar)
          : response(404, { message: 'calendar not found' });
      }
      if (method === 'DELETE') {
        const users = (await store.listRules(tenantId)).filter(
          (rule) => rule.calendarId === calendarId,
        );
        if (users.length)
          return response(409, {
            message: `calendar is used by alert rules: ${users.map((rule) => rule.name).join(', ')}`,
          });
        return (await store.deleteCalendar(tenantId, calendarId))
          ? response(204, undefined)
          : response(404, { message: 'calendar not found' });
      }
    }

    if (path === '/alert-rules') {
      if (method === 'GET') {
        if (!isAdmin) return adminRequired();
        return response(200, { items: await store.listRules(tenantId) });
      }
      if (method === 'POST') {
        if (!isAdmin) return adminRequired();
        const input = parseRule(event.body) as RuleInput;
        if ((await store.listRules(tenantId)).length >= MAX_RULES)
          return response(409, { message: `an account can have at most ${MAX_RULES} alert rules` });
        await checkReferences(store, fleet, tenantId, input);
        return response(201, await store.createRule(tenantId, input));
      }
    }
    const ruleMatch = path.match(/^\/alert-rules\/([^/]+)$/);
    if (ruleMatch?.[1]) {
      if (!isAdmin) return adminRequired();
      const ruleId = ruleMatch[1];
      if (method === 'PATCH') {
        const changes = parseRule(event.body, true);
        const existing = (await store.listRules(tenantId)).find((rule) => rule.ruleId === ruleId);
        if (!existing) return response(404, { message: 'alert rule not found' });
        const merged = { ...existing, ...changes };
        await checkReferences(store, fleet, tenantId, merged);
        const rule = await store.updateRule(tenantId, ruleId, changes);
        return rule ? response(200, rule) : response(404, { message: 'alert rule not found' });
      }
      if (method === 'DELETE') {
        return (await store.deleteRule(tenantId, ruleId))
          ? response(204, undefined)
          : response(404, { message: 'alert rule not found' });
      }
    }
    return undefined;
  };
}

async function checkReferences(
  store: NotificationStore,
  fleet: FleetDirectory,
  tenantId: string,
  rule: Pick<
    AlertRule,
    'deviceIds' | 'groupIds' | 'userIds' | 'calendarId' | 'channels' | 'command'
  >,
) {
  if (rule.channels.includes('command') !== Boolean(rule.command))
    throw new InputError('the command channel and a command must be chosen together');
  const [devices, groups, users] = await Promise.all([
    rule.deviceIds.length ? fleet.listDevices(tenantId) : [],
    rule.groupIds.length ? fleet.listGroups(tenantId) : [],
    rule.userIds.length ? fleet.listUsers(tenantId) : [],
  ]);
  const missing = (ids: string[], known: string[]) => ids.filter((id) => !known.includes(id));
  const unknown = [
    ...missing(
      rule.deviceIds,
      devices.map((device) => device.deviceId),
    ).map((id) => `vehicle ${id}`),
    ...missing(
      rule.groupIds,
      groups.map((group) => group.groupId),
    ).map((id) => `group ${id}`),
    ...missing(
      rule.userIds,
      users.map((user) => user.userId),
    ).map((id) => `user ${id}`),
  ];
  if (rule.calendarId && !(await store.getCalendar(tenantId, rule.calendarId)))
    unknown.push(`calendar ${rule.calendarId}`);
  if (unknown.length) throw new InputError(`unknown ${unknown.join(', ')}`);
}

function parseRule(body: string | undefined, partial = false) {
  const value = jsonObject(body);
  const rule: Record<string, unknown> = {};
  const field = (key: string, parse: (value: unknown) => unknown) => {
    if (value[key] !== undefined) rule[key] = parse(value[key]);
    else if (!partial) rule[key] = parse(undefined);
  };
  field('name', (name) => required(text(name, 'name', 1, 100).trim(), 'name'));
  field('enabled', (enabled) => {
    if (enabled === undefined) return true;
    if (typeof enabled !== 'boolean') throw new InputError('enabled must be true or false');
    return enabled;
  });
  field('eventTypes', (types) => {
    const list = idList(types, 'eventTypes', 1);
    const invalid = list.filter((type) => !eventTypeSchema.safeParse(type).success);
    if (invalid.length) throw new InputError(`unknown event types: ${invalid.join(', ')}`);
    return list;
  });
  field('alarms', (alarms) => {
    const list = alarms === undefined ? [] : idList(alarms, 'alarms');
    const invalid = list.filter((alarm) => !alarmTypeSchema.safeParse(alarm).success);
    if (invalid.length) throw new InputError(`unknown alarms: ${invalid.join(', ')}`);
    return list;
  });
  for (const key of ['deviceIds', 'groupIds', 'userIds'])
    field(key, (ids) => (ids === undefined ? [] : idList(ids, key)));
  field('channels', (channels) => {
    const list = idList(channels, 'channels', 1);
    if (!list.every(isNotificationChannel))
      throw new InputError(
        'channels must be web, email, push, sms, telegram, whatsapp, pushover or command',
      );
    return list;
  });
  if (value.calendarId !== undefined)
    rule.calendarId = clearable(value.calendarId, (id) => text(id, 'calendarId', 1, 64));
  if (value.command !== undefined) rule.command = clearable(value.command, command);
  if (partial && !Object.keys(rule).length)
    throw new InputError('at least one field to change is required');
  return rule;
}

function command(value: unknown) {
  if (!isRecord(value)) throw new InputError('command is invalid');
  const type = text(value.type, 'command type', 2, 32);
  if (!RULE_COMMANDS.includes(type)) throw new InputError('command type is unsupported');
  return { type, payload: isRecord(value.payload) ? value.payload : {} };
}

function parseCalendar(body: string | undefined, partial = false): CalendarInput {
  const value = jsonObject(body);
  const calendar: Partial<CalendarInput> = {};
  if (value.name !== undefined || !partial)
    calendar.name = required(text(value.name, 'name', 1, 100).trim(), 'name');
  if (value.timeZone !== undefined || !partial) {
    if (!isTimeZone(value.timeZone)) throw new InputError('timeZone must be an IANA time zone');
    calendar.timeZone = value.timeZone;
  }
  if (value.windows !== undefined || !partial) {
    if (
      !Array.isArray(value.windows) ||
      !value.windows.length ||
      value.windows.length > MAX_WINDOWS
    )
      throw new InputError(`windows must list 1 to ${MAX_WINDOWS} weekly windows`);
    calendar.windows = value.windows.map((window) => {
      if (!isRecord(window)) throw new InputError('each window needs days, start and end');
      const days = window.days;
      if (
        !Array.isArray(days) ||
        !days.length ||
        days.some((day) => !Number.isInteger(day) || (day as number) < 0 || (day as number) > 6)
      )
        throw new InputError('window days must be numbers from 0 (Sunday) to 6 (Saturday)');
      if (!isTimeOfDay(window.start) || !isTimeOfDay(window.end))
        throw new InputError('window start and end must be HH:MM');
      return { days: [...new Set(days as number[])].sort(), start: window.start, end: window.end };
    });
  }
  if (partial && !Object.keys(calendar).length)
    throw new InputError('at least one field to change is required');
  return calendar as CalendarInput;
}

function parseContact(body: string | undefined) {
  const value = jsonObject(body);
  const changes: { [K in keyof UserContact]?: string | null } = {};
  if (value.phone !== undefined)
    changes.phone = clearable(value.phone, (phone) => {
      // E.164, which SMS and WhatsApp both need.
      if (typeof phone !== 'string' || !/^\+[1-9]\d{6,14}$/.test(phone))
        throw new InputError('phone must be in international format, e.g. +919876543210');
      return phone;
    });
  if (value.telegramChatId !== undefined)
    changes.telegramChatId = clearable(value.telegramChatId, (id) => {
      if (typeof id !== 'string' || !/^-?\d{1,20}$/.test(id))
        throw new InputError('telegramChatId must be the numeric chat id');
      return id;
    });
  if (value.pushoverUserKey !== undefined)
    changes.pushoverUserKey = clearable(value.pushoverUserKey, (key) => {
      if (typeof key !== 'string' || !/^[A-Za-z0-9]{30}$/.test(key))
        throw new InputError('pushoverUserKey must be the 30-character user key');
      return key;
    });
  if (!Object.keys(changes).length)
    throw new InputError('at least one field to change is required');
  return changes;
}

function idList(value: unknown, name: string, min = 0): string[] {
  if (
    !Array.isArray(value) ||
    value.length < min ||
    value.length > MAX_LIST ||
    value.some((id) => typeof id !== 'string' || !id || id.length > 64)
  )
    throw new InputError(
      `${name} must be a list of ${min ? 'at least one, ' : ''}up to ${MAX_LIST} ids`,
    );
  return [...new Set(value as string[])];
}

function required(value: string, name: string) {
  if (!value) throw new InputError(`${name} is invalid`);
  return value;
}

import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import type { AlertRule, Calendar } from '@trackify/domain';
import { describe, expect, it, vi } from 'vitest';
import { createNotificationRoutes, type NotificationStore } from '../src/notifications';
import { InputError } from '../src/http';

type Role = 'admin' | 'dispatcher' | 'viewer';

function request(method: string, rawPath: string, body?: unknown) {
  return {
    rawPath,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { http: { method } },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

const membership = (role: Role = 'admin') => ({
  tenantId: 't',
  userId: 'user-1',
  role,
  groupIds: [],
});

const calendar: Calendar = {
  tenantId: 't',
  calendarId: 'office',
  name: 'Office',
  timeZone: 'Asia/Kolkata',
  windows: [{ days: [1], start: '09:00', end: '18:00' }],
};

function store(rules: AlertRule[] = []) {
  return {
    listRules: vi.fn().mockResolvedValue(rules),
    createRule: vi.fn((tenantId: string, input: object) =>
      Promise.resolve({ ...input, tenantId, ruleId: 'r-new' } as AlertRule),
    ),
    updateRule: vi.fn().mockResolvedValue({ ruleId: 'r1' }),
    deleteRule: vi.fn().mockResolvedValue(true),
    listCalendars: vi.fn().mockResolvedValue([calendar]),
    getCalendar: vi.fn((_t: string, id: string) =>
      Promise.resolve(id === 'office' ? calendar : undefined),
    ),
    createCalendar: vi.fn((tenantId: string, input: object) =>
      Promise.resolve({ ...input, tenantId, calendarId: 'c-new' } as Calendar),
    ),
    updateCalendar: vi.fn().mockResolvedValue(calendar),
    deleteCalendar: vi.fn().mockResolvedValue(true),
    savePushToken: vi.fn().mockResolvedValue({ tokenId: 'x' }),
    listPushTokens: vi.fn().mockResolvedValue([]),
    deletePushToken: vi.fn().mockResolvedValue(true),
    updateContact: vi.fn().mockResolvedValue({ phone: '+919876543210' }),
  } satisfies NotificationStore;
}

const fleet = {
  listDevices: vi.fn().mockResolvedValue([{ deviceId: 'van' }]),
  listGroups: vi.fn().mockResolvedValue([{ tenantId: 't', groupId: 'north', name: 'North' }]),
  listUsers: vi
    .fn()
    .mockResolvedValue([
      { tenantId: 't', userId: 'asha', role: 'admin', enabled: true, groupIds: [] },
    ]),
};

async function call(
  routes: ReturnType<typeof createNotificationRoutes>,
  ...args: Parameters<typeof routes>
) {
  try {
    return await routes(...args);
  } catch (error) {
    if (error instanceof InputError) return { statusCode: 400, body: error.message };
    throw error;
  }
}

const sos = {
  name: 'SOS',
  eventTypes: ['alarm'],
  alarms: ['sos'],
  channels: ['push', 'sms'],
};

describe('alert rules', () => {
  it('creates a rule with defaults for the whole fleet and all administrators', async () => {
    const notifications = store();
    const routes = createNotificationRoutes(notifications, fleet);
    const result = await call(routes, request('POST', '/alert-rules', sos), membership());
    expect(result?.statusCode).toBe(201);
    expect(notifications.createRule).toHaveBeenCalledWith('t', {
      ...sos,
      enabled: true,
      deviceIds: [],
      groupIds: [],
      userIds: [],
    });
  });

  it('rejects unknown event types, alarms, channels and references', async () => {
    const routes = createNotificationRoutes(store(), fleet);
    for (const body of [
      { ...sos, eventTypes: ['explosion'] },
      { ...sos, alarms: ['dragon'] },
      { ...sos, channels: ['pigeon'] },
      { ...sos, eventTypes: [] },
      { ...sos, deviceIds: ['ghost'] },
      { ...sos, groupIds: ['nowhere'] },
      { ...sos, userIds: ['stranger'] },
      { ...sos, calendarId: 'missing' },
    ]) {
      const result = await call(routes, request('POST', '/alert-rules', body), membership());
      expect(result?.statusCode, JSON.stringify(body)).toBe(400);
    }
  });

  it('requires a command exactly when the command channel is chosen', async () => {
    const routes = createNotificationRoutes(store(), fleet);
    const missing = await call(
      routes,
      request('POST', '/alert-rules', { ...sos, channels: ['command'] }),
      membership(),
    );
    expect(missing?.statusCode).toBe(400);
    const valid = await call(
      routes,
      request('POST', '/alert-rules', {
        ...sos,
        channels: ['command'],
        command: { type: 'engineStop' },
      }),
      membership(),
    );
    expect(valid?.statusCode).toBe(201);
  });

  it('checks the merged rule when editing', async () => {
    const existing = {
      ...sos,
      tenantId: 't',
      ruleId: 'r1',
      enabled: true,
      deviceIds: [],
      groupIds: [],
      userIds: [],
    } as AlertRule;
    const routes = createNotificationRoutes(store([existing]), fleet);
    const ok = await call(
      routes,
      request('PATCH', '/alert-rules/r1', { enabled: false }),
      membership(),
    );
    expect(ok?.statusCode).toBe(200);
    const bad = await call(
      routes,
      request('PATCH', '/alert-rules/r1', { channels: ['command'] }),
      membership(),
    );
    expect(bad?.statusCode).toBe(400);
    const missing = await call(
      routes,
      request('PATCH', '/alert-rules/r9', { enabled: false }),
      membership(),
    );
    expect(missing?.statusCode).toBe(404);
  });

  it('is for administrators only', async () => {
    const routes = createNotificationRoutes(store(), fleet);
    for (const [method, path] of [
      ['GET', '/alert-rules'],
      ['POST', '/alert-rules'],
      ['DELETE', '/alert-rules/r1'],
    ] as const) {
      const result = await call(routes, request(method, path, sos), membership('dispatcher'));
      expect(result?.statusCode).toBe(403);
    }
  });
});

describe('calendars', () => {
  it('validates time zone and windows', async () => {
    const routes = createNotificationRoutes(store(), fleet);
    const good = {
      name: 'Night',
      timeZone: 'Asia/Kolkata',
      windows: [{ days: [5, 5, 6], start: '22:00', end: '06:00' }],
    };
    const created = await call(routes, request('POST', '/calendars', good), membership());
    expect(created?.statusCode).toBe(201);
    for (const body of [
      { ...good, timeZone: 'Moon/Base' },
      { ...good, windows: [] },
      { ...good, windows: [{ days: [7], start: '22:00', end: '06:00' }] },
      { ...good, windows: [{ days: [1], start: '25:00', end: '06:00' }] },
    ]) {
      const result = await call(routes, request('POST', '/calendars', body), membership());
      expect(result?.statusCode).toBe(400);
    }
  });

  it('will not delete a calendar that rules still use', async () => {
    const rule = { ruleId: 'r1', name: 'Night SOS', calendarId: 'office' } as AlertRule;
    const notifications = store([rule]);
    const routes = createNotificationRoutes(notifications, fleet);
    const result = await call(routes, request('DELETE', '/calendars/office'), membership());
    expect(result?.statusCode).toBe(409);
    expect(notifications.deleteCalendar).not.toHaveBeenCalled();
  });
});

describe('my contact details and devices', () => {
  it('lets any user set where they are reached, in a deliverable format', async () => {
    const notifications = store();
    const routes = createNotificationRoutes(notifications, fleet);
    const viewer = membership('viewer');
    const ok = await call(
      routes,
      request('PATCH', '/me', { phone: '+919876543210', telegramChatId: null }),
      viewer,
    );
    expect(ok?.statusCode).toBe(200);
    expect(notifications.updateContact).toHaveBeenCalledWith('t', 'user-1', {
      phone: '+919876543210',
      telegramChatId: null,
    });
    for (const body of [
      { phone: '98765 43210' },
      { telegramChatId: '@me' },
      { pushoverUserKey: 'short' },
    ]) {
      const result = await call(routes, request('PATCH', '/me', body), viewer);
      expect(result?.statusCode).toBe(400);
    }
  });

  it('registers and removes push tokens for the signed-in user only', async () => {
    const notifications = store();
    const routes = createNotificationRoutes(notifications, fleet);
    const token = 'f'.repeat(40);
    await call(
      routes,
      request('POST', '/me/push-tokens', { token, platform: 'android' }),
      membership('viewer'),
    );
    expect(notifications.savePushToken).toHaveBeenCalledWith('t', 'user-1', token, 'android');
    const bad = await call(
      routes,
      request('POST', '/me/push-tokens', { token, platform: 'fax' }),
      membership(),
    );
    expect(bad?.statusCode).toBe(400);
    await call(routes, request('DELETE', `/me/push-tokens/${'a'.repeat(32)}`), membership());
    expect(notifications.deletePushToken).toHaveBeenCalledWith('t', 'user-1', 'a'.repeat(32));
  });
});

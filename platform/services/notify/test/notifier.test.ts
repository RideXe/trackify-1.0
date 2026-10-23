import { describe, expect, it, vi } from 'vitest';
import type { FleetUser } from '@trackify/data';
import type { AlertRule, EventMessage } from '@trackify/domain';
import { StaleTokenError, type Channels } from '../src/channels';
import { Notifier, recipientsOf, type NotifyData } from '../src/notifier';

const KEY = { pk: 'TENANT#t#DEVICE#van', sk: '0001760000000000#e1' };
const SOS: EventMessage = {
  v: 1,
  eventId: 'e1',
  tenantId: 't',
  deviceId: 'van',
  type: 'alarm',
  alarm: 'sos',
  eventTime: Date.parse('2026-10-12T10:00:00+05:30'),
  positionFixTime: 1,
  attributes: {},
};

function user(userId: string, extra: Partial<FleetUser> = {}): FleetUser {
  return {
    tenantId: 't',
    userId,
    role: 'admin',
    enabled: true,
    groupIds: [],
    email: `${userId}@example.com`,
    ...extra,
  };
}

function rule(extra: Partial<AlertRule> = {}): AlertRule {
  return {
    tenantId: 't',
    ruleId: 'r1',
    name: 'SOS',
    enabled: true,
    eventTypes: ['alarm'],
    alarms: [],
    deviceIds: [],
    groupIds: [],
    channels: ['email'],
    userIds: [],
    ...extra,
  };
}

function data(overrides: Partial<NotifyData> = {}) {
  return {
    rules: vi.fn().mockResolvedValue([rule()]),
    event: vi.fn().mockResolvedValue(SOS),
    device: vi.fn().mockResolvedValue({ name: 'North Van', groupId: 'north' }),
    users: vi.fn().mockResolvedValue([user('asha')]),
    calendar: vi.fn().mockResolvedValue(undefined),
    timeZone: vi.fn().mockResolvedValue(undefined),
    geofenceName: vi.fn().mockResolvedValue(undefined),
    driverName: vi.fn().mockResolvedValue(undefined),
    position: vi.fn().mockResolvedValue({ latitude: 12.97, longitude: 77.59, speedKmh: 42 }),
    pushTokens: vi.fn().mockResolvedValue([]),
    forgetPushToken: vi.fn().mockResolvedValue(undefined),
    createCommand: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } satisfies NotifyData;
}

function channels() {
  return {
    email: vi.fn<Channels['email']>().mockResolvedValue(undefined),
    sms: vi.fn<Channels['sms']>().mockResolvedValue(undefined),
    push: vi.fn<Channels['push']>().mockResolvedValue(undefined),
    telegram: vi.fn<Channels['telegram']>().mockResolvedValue(undefined),
    whatsapp: vi.fn<Channels['whatsapp']>().mockResolvedValue(undefined),
    pushover: vi.fn<Channels['pushover']>().mockResolvedValue(undefined),
  } satisfies Channels;
}

describe('notifier', () => {
  it('emails administrators about a matching event with time in the fleet’s zone', async () => {
    const send = channels();
    const deliveries = await new Notifier(data(), send, undefined).handle(KEY);
    expect(deliveries).toEqual([
      { source: 'r1', channel: 'email', userId: 'asha', outcome: 'sent' },
    ]);
    const [to, message] = send.email.mock.calls[0] as [string, { title: string; text: string }];
    expect(to).toBe('asha@example.com');
    expect(message.title).toBe('North Van: alarm!');
    expect(message.text).toBe('North Van alarm: SOS at 2026-10-12 10:00:00 — 12.97000, 77.59000');
  });

  it('reads nothing more when the fleet has no enabled rules', async () => {
    const store = data({ rules: vi.fn().mockResolvedValue([rule({ enabled: false })]) });
    expect(await new Notifier(store, channels(), undefined).handle(KEY)).toEqual([]);
    expect(store.event).not.toHaveBeenCalled();
  });

  it('caches rules for a minute', async () => {
    const store = data();
    let now = 0;
    const notifier = new Notifier(store, channels(), undefined, undefined, () => now);
    await notifier.handle(KEY);
    await notifier.handle(KEY);
    now = 61_000;
    await notifier.handle(KEY);
    expect(store.rules).toHaveBeenCalledTimes(2);
  });

  it('stays quiet outside the rule’s calendar', async () => {
    const calendar = {
      tenantId: 't',
      calendarId: 'night',
      name: 'Night',
      timeZone: 'Asia/Kolkata',
      windows: [{ days: [0, 1, 2, 3, 4, 5, 6], start: '20:00', end: '06:00' }],
    };
    const store = data({
      rules: vi.fn().mockResolvedValue([rule({ calendarId: 'night' })]),
      calendar: vi.fn().mockResolvedValue(calendar),
    });
    const send = channels();
    expect(await new Notifier(store, send, undefined).handle(KEY)).toEqual([]);
    expect(send.email).not.toHaveBeenCalled();
  });

  it('reports each channel separately: sent, skipped for missing details, failed', async () => {
    const send = channels();
    send.sms.mockRejectedValue(new Error('throttled'));
    const store = data({
      rules: vi.fn().mockResolvedValue([rule({ channels: ['sms', 'telegram'] })]),
      users: vi.fn().mockResolvedValue([user('asha', { phone: '+919876543210' })]),
    });
    const deliveries = await new Notifier(store, send, undefined).handle(KEY);
    expect(deliveries.map((delivery) => [delivery.channel, delivery.outcome])).toEqual([
      ['sms', 'failed'],
      ['telegram', 'skipped'],
    ]);
  });

  it('pushes to every device and forgets tokens FCM no longer accepts', async () => {
    const send = channels();
    send.push.mockImplementation((token: string) =>
      token === 'dead' ? Promise.reject(new StaleTokenError('gone')) : Promise.resolve(),
    );
    const store = data({
      rules: vi.fn().mockResolvedValue([rule({ channels: ['push'] })]),
      pushTokens: vi.fn().mockResolvedValue([
        { tokenId: 'a', userId: 'asha', token: 'live', platform: 'android', createdAt: 1 },
        { tokenId: 'b', userId: 'asha', token: 'dead', platform: 'web', createdAt: 1 },
      ]),
    });
    const deliveries = await new Notifier(store, send, undefined).handle(KEY);
    expect(deliveries[0]?.outcome).toBe('sent');
    expect(store.forgetPushToken).toHaveBeenCalledWith('t', 'asha', 'b');
  });

  it('publishes web notifications to each recipient’s own channel', async () => {
    const web = { publish: vi.fn().mockResolvedValue(undefined) };
    const store = data({ rules: vi.fn().mockResolvedValue([rule({ channels: ['web'] })]) });
    await new Notifier(store, channels(), web).handle(KEY);
    expect(web.publish).toHaveBeenCalledWith(
      't',
      'asha',
      expect.objectContaining({ eventId: 'e1', title: 'North Van: alarm!' }),
    );
  });

  it('sends the rule’s command to the vehicle once, not once per recipient', async () => {
    const store = data({
      rules: vi
        .fn()
        .mockResolvedValue([
          rule({ channels: ['command'], command: { type: 'engineStop', payload: {} } }),
        ]),
      users: vi.fn().mockResolvedValue([user('asha'), user('ravi')]),
    });
    await new Notifier(store, channels(), undefined).handle(KEY);
    expect(store.createCommand).toHaveBeenCalledTimes(1);
    expect(store.createCommand).toHaveBeenCalledWith(
      't',
      'van',
      { type: 'engineStop', payload: {} },
      'r1',
    );
  });

  it('ignores events from keys that are not vehicle events', async () => {
    const store = data();
    expect(await new Notifier(store, channels(), undefined).handle({ pk: 'X', sk: 'y' })).toEqual(
      [],
    );
    expect(store.rules).not.toHaveBeenCalled();
  });
});

describe('recipients', () => {
  const users = [
    user('admin'),
    user('north', { role: 'dispatcher', groupIds: ['north'] }),
    user('south', { role: 'dispatcher', groupIds: ['south'] }),
    user('all', { role: 'viewer' }),
    user('off', { enabled: false }),
  ];

  it('defaults to active administrators', () => {
    expect(recipientsOf(rule(), users, 'north').map((u) => u.userId)).toEqual(['admin']);
  });

  it('never tells a user about a vehicle outside their groups', () => {
    const everyone = rule({ userIds: users.map((u) => u.userId) });
    expect(recipientsOf(everyone, users, 'north').map((u) => u.userId)).toEqual([
      'admin',
      'north',
      'all',
    ]);
  });
});

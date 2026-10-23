import type { FleetUser, PushToken } from '@trackify/data';
import {
  calendarActive,
  ruleMatches,
  type AlertRule,
  type Calendar,
  type EventMessage,
} from '@trackify/domain';
import { noGeocoder, type Geocoder } from '@trackify/geocoder';
import type { Channels } from './channels';
import { fanOut, type Delivery, type WebPublisher } from './fanout';
import { formatMessage, type Message, type MessageContext } from './format';

export const DEFAULT_TIME_ZONE = 'Asia/Kolkata';
const RULE_CACHE_MS = 60_000;

export interface NotifiedDevice {
  name: string;
  groupId?: string;
  driverId?: string;
  speedLimitKmh?: number;
}

/** The reads and writes notification needs; DynamoDB in production, fakes in tests. */
export interface NotifyData {
  rules(tenantId: string): Promise<AlertRule[]>;
  event(key: { pk: string; sk: string }): Promise<EventMessage | undefined>;
  device(tenantId: string, deviceId: string): Promise<NotifiedDevice | undefined>;
  users(tenantId: string): Promise<FleetUser[]>;
  calendar(tenantId: string, calendarId: string): Promise<Calendar | undefined>;
  timeZone(tenantId: string): Promise<string | undefined>;
  geofenceName(tenantId: string, geofenceId: string): Promise<string | undefined>;
  driverName(tenantId: string, driverId: string): Promise<string | undefined>;
  position(
    tenantId: string,
    deviceId: string,
    fixTime: number,
  ): Promise<
    { latitude: number; longitude: number; speedKmh?: number; address?: string } | undefined
  >;
  pushTokens(tenantId: string, userId: string): Promise<PushToken[]>;
  forgetPushToken(tenantId: string, userId: string, tokenId: string): Promise<void>;
  createCommand(
    tenantId: string,
    deviceId: string,
    command: NonNullable<AlertRule['command']>,
    ruleId: string,
  ): Promise<void>;
}

/** Turns stored events into notifications. Delivery failures are reported, never thrown. */
export class Notifier {
  private readonly ruleCache = new Map<string, { rules: AlertRule[]; expires: number }>();

  constructor(
    private readonly data: NotifyData,
    private readonly channels: Channels,
    private readonly web: WebPublisher | undefined,
    private readonly dashboardUrl?: string,
    private readonly now: () => number = Date.now,
    private readonly geocoder: Geocoder = noGeocoder,
  ) {}

  /** Keys of a new Events item: pk TENANT#<tenant>#DEVICE#<device>, sk <time>#<eventId>. */
  async handle(key: { pk: string; sk: string }): Promise<Delivery[]> {
    const tenantId = /^TENANT#([^#]+)#DEVICE#/.exec(key.pk)?.[1];
    if (!tenantId) return [];
    // Most fleets have few rules and most events match none: decide that before reading more.
    const rules = (await this.rulesFor(tenantId)).filter((rule) => rule.enabled);
    if (!rules.length) return [];
    const event = await this.data.event(key);
    if (!event) return [];
    const device = await this.data.device(tenantId, event.deviceId);
    if (!device) return [];
    const target = {
      type: event.type,
      alarm: event.alarm,
      deviceId: event.deviceId,
      groupId: device.groupId,
    };
    const candidates = rules.filter((rule) => ruleMatches(rule, target));
    const matched: AlertRule[] = [];
    for (const rule of candidates)
      if (await this.calendarAllows(tenantId, rule, event.eventTime)) matched.push(rule);
    if (!matched.length) return [];

    const message = formatMessage(await this.context(tenantId, event, device));
    const users = await this.data.users(tenantId);
    const deliveries: Delivery[] = [];
    for (const rule of matched)
      deliveries.push(...(await this.deliver(tenantId, rule, event, device, users, message)));
    return deliveries;
  }

  private async deliver(
    tenantId: string,
    rule: AlertRule,
    event: EventMessage,
    device: NotifiedDevice,
    users: FleetUser[],
    message: Message,
  ): Promise<Delivery[]> {
    const deliveries = fanOut(
      { channels: this.channels, web: this.web, push: this.data },
      {
        tenantId,
        source: rule.ruleId,
        recipients: recipientsOf(rule, users, device.groupId),
        channels: rule.channels,
        message,
        notification: {
          kind: 'alert',
          eventId: event.eventId,
          type: event.type,
          deviceId: event.deviceId,
          eventTime: event.eventTime,
          title: message.title,
          text: message.text,
        },
      },
    );
    // The command goes to the vehicle once, not once per recipient.
    const command =
      rule.channels.includes('command') && rule.command
        ? this.data.createCommand(tenantId, event.deviceId, rule.command, rule.ruleId).then(
            (): Delivery => ({ source: rule.ruleId, channel: 'command', outcome: 'sent' }),
            (error: unknown): Delivery => ({
              source: rule.ruleId,
              channel: 'command',
              outcome: 'failed',
              reason: error instanceof Error ? error.message : String(error),
            }),
          )
        : undefined;
    return [...(command ? [await command] : []), ...(await deliveries)];
  }

  private async rulesFor(tenantId: string) {
    const cached = this.ruleCache.get(tenantId);
    if (cached && cached.expires > this.now()) return cached.rules;
    const rules = await this.data.rules(tenantId);
    this.ruleCache.set(tenantId, { rules, expires: this.now() + RULE_CACHE_MS });
    return rules;
  }

  private async calendarAllows(tenantId: string, rule: AlertRule, at: number) {
    if (!rule.calendarId) return true;
    const calendar = await this.data.calendar(tenantId, rule.calendarId);
    // A deleted calendar cannot silence alerts forever.
    return !calendar || calendarActive(calendar, at);
  }

  private async context(
    tenantId: string,
    event: EventMessage,
    device: NotifiedDevice,
  ): Promise<MessageContext> {
    const attribute = (key: string) => {
      const value = event.attributes[key];
      return value === undefined || value === null ? undefined : String(value);
    };
    const driverId = attribute('driverUniqueId') ?? attribute('driverId') ?? device.driverId;
    const linkedDeviceId = attribute('linkedDeviceId');
    const [timeZone, geofenceName, driverName, position, linked] = await Promise.all([
      this.data.timeZone(tenantId),
      event.geofenceId ? this.data.geofenceName(tenantId, event.geofenceId) : undefined,
      // Speeding events name who was driving; driver changes name the new driver.
      (event.type === 'driverChanged' ||
        event.type === 'deviceOverspeed' ||
        event.type === 'overspeedEnded') &&
      driverId
        ? this.data.driverName(tenantId, driverId)
        : undefined,
      event.positionFixTime !== undefined
        ? this.data.position(tenantId, event.deviceId, event.positionFixTime)
        : undefined,
      linkedDeviceId ? this.data.device(tenantId, linkedDeviceId) : undefined,
    ]);
    return {
      type: event.type,
      eventTime: event.eventTime,
      deviceName: device.name,
      timeZone: timeZone ?? DEFAULT_TIME_ZONE,
      alarm: event.alarm,
      geofenceName,
      driverName,
      maintenanceName: attribute('maintenanceName'),
      // Speeding events record the speed and limit they were raised with.
      speedKmh:
        numeric(event.attributes.maxSpeedKmh ?? event.attributes.speedKmh) ?? position?.speedKmh,
      speedLimitKmh: numeric(event.attributes.speedLimitKmh) ?? device.speedLimitKmh,
      durationS: numeric(event.attributes.durationS),
      latitude: position?.latitude,
      longitude: position?.longitude,
      // Shown in the alert only, so a display licence is enough.
      address:
        position?.address ??
        (position
          ? await this.geocoder.address(position.latitude, position.longitude, 'display')
          : undefined),
      // The event logic records these under fixed keys for the message to mention.
      detail:
        attribute('result') ??
        attribute('fuelChange') ??
        linked?.name ??
        attribute('media') ??
        attribute('driverUniqueId'),
      dashboardUrl: this.dashboardUrl,
    };
  }
}

/**
 * Chosen users (or every administrator), active, and allowed to see the vehicle: a dispatcher
 * limited to the north depot is never told about a south depot bus.
 */
export function recipientsOf(rule: AlertRule, users: FleetUser[], groupId: string | undefined) {
  const chosen = rule.userIds.length
    ? users.filter((user) => rule.userIds.includes(user.userId))
    : users.filter((user) => user.role === 'admin');
  return chosen.filter(
    (user) =>
      user.enabled &&
      (user.role === 'admin' ||
        !user.groupIds.length ||
        (groupId !== undefined && user.groupIds.includes(groupId))),
  );
}

export type { Delivery, WebPublisher } from './fanout';

function numeric(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

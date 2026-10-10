import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import type { Announcement, AuditEntry, FleetUser, Membership, ShareLink } from '@trackify/data';
import { isNotificationChannel, type NotificationChannel } from '@trackify/domain';
import { sees } from './admin';
import { boundedNumber, InputError, jsonObject, response, text } from './http';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface ExtrasData {
  getDevice(
    tenantId: string,
    deviceId: string,
  ): Promise<{ deviceId: string; groupId?: string } | undefined>;
  listDevices(
    tenantId: string,
  ): Promise<Array<{ deviceId: string; groupId?: string; state?: { status?: string } }>>;
  listUsers(tenantId: string): Promise<FleetUser[]>;
  tenantEvents(tenantId: string, from: number, to: number, limit: number): Promise<unknown[]>;
  openAlerts(tenantId: string): Promise<number>;
}

export interface ShareStore {
  create(input: Omit<ShareLink, 'shareId' | 'createdAt'>): Promise<ShareLink & { token: string }>;
  list(tenantId: string, deviceId: string): Promise<ShareLink[]>;
  revoke(tenantId: string, deviceId: string, shareId: string): Promise<boolean>;
}

export interface AuditLog {
  list(tenantId: string, from: number, to: number, limit?: number): Promise<AuditEntry[]>;
}

export interface Announcements {
  create(input: Omit<Announcement, 'announcementId' | 'createdAt'>): Promise<Announcement>;
  active(tenantId: string): Promise<Announcement[]>;
}

/** Hands an announcement to the notification service for delivery. */
export interface AnnouncementQueue {
  publish(tenantId: string, announcementId: string): Promise<void>;
}

export interface Extras {
  shares?: ShareStore;
  audit?: AuditLog;
  announcements?: Announcements;
  announcementQueue?: AnnouncementQueue;
  /** Base of public share links, e.g. https://fleet.example.com */
  shareBaseUrl: string;
}

/** Share links, audit log, statistics and announcements. */
export function createExtraRoutes(data: ExtrasData, extras: Extras, now: () => number = Date.now) {
  return async (
    event: APIGatewayProxyEventV2WithJWTAuthorizer,
    membership: Membership,
  ): Promise<ReturnType<typeof response> | undefined> => {
    const method = event.requestContext.http.method;
    const path = event.rawPath;
    const { tenantId } = membership;
    const isAdmin = membership.role === 'admin';

    const shareList = path.match(/^\/devices\/([^/]+)\/shares$/);
    const shareItem = path.match(/^\/devices\/([^/]+)\/shares\/([a-f0-9]{32})$/);
    if (shareList?.[1] || shareItem?.[1]) {
      if (!extras.shares) return response(503, { message: 'sharing unavailable' });
      if (membership.role === 'viewer')
        return response(403, { message: 'dispatcher role required' });
      const deviceId = (shareList?.[1] ?? shareItem?.[1])!;
      const device = await data.getDevice(tenantId, deviceId);
      if (!device || !sees(membership, device.groupId))
        return response(404, { message: 'device not found' });
      if (shareList && method === 'GET')
        return response(200, { items: await extras.shares.list(tenantId, deviceId) });
      if (shareList && method === 'POST') {
        const value = event.body ? jsonObject(event.body) : {};
        const hours = boundedNumber(value.expiresInHours, 24, 1, 7 * 24);
        const link = await extras.shares.create({
          tenantId,
          deviceId,
          createdBy: membership.email ?? membership.userId,
          expiresAtMs: now() + hours * HOUR,
        });
        const { token, ...stored } = link;
        // The token is shown once, inside the link; only its hash is kept.
        return response(201, {
          ...stored,
          url: `${extras.shareBaseUrl.replace(/\/$/, '')}/shared/#${token}`,
        });
      }
      if (shareItem?.[2] && method === 'DELETE')
        return (await extras.shares.revoke(tenantId, deviceId, shareItem[2]))
          ? response(204, undefined)
          : response(404, { message: 'share link not found' });
    }

    if (path === '/audit' && method === 'GET') {
      if (!isAdmin) return response(403, { message: 'admin role required' });
      if (!extras.audit) return response(503, { message: 'audit log unavailable' });
      const query = event.queryStringParameters ?? {};
      const to = boundedNumber(query.to, now(), 0, now() + 300_000);
      const from = boundedNumber(query.from, to - 7 * DAY, Math.max(0, to - 366 * DAY), to);
      return response(200, {
        items: await extras.audit.list(
          tenantId,
          from,
          to,
          boundedNumber(query.limit, 500, 1, 1_000),
        ),
      });
    }

    if (path === '/statistics' && method === 'GET') {
      if (!isAdmin) return response(403, { message: 'admin role required' });
      const [devices, users, events, openAlerts] = await Promise.all([
        data.listDevices(tenantId),
        data.listUsers(tenantId),
        data.tenantEvents(tenantId, now() - DAY, now(), 5_000),
        data.openAlerts(tenantId),
      ]);
      const online = devices.filter((device) => device.state?.status === 'online').length;
      return response(200, {
        vehicles: devices.length,
        online,
        offline: devices.length - online,
        users: users.length,
        activeUsers: users.filter((user) => user.enabled).length,
        eventsLast24h: events.length,
        eventsLast24hCapped: events.length >= 5_000,
        openAlerts,
      });
    }

    if (path === '/announcements') {
      if (!extras.announcements) return response(503, { message: 'announcements unavailable' });
      if (method === 'GET')
        return response(200, { items: await extras.announcements.active(tenantId) });
      if (method === 'POST') {
        if (!isAdmin) return response(403, { message: 'admin role required' });
        const value = jsonObject(event.body);
        const channels = value.channels ?? ['web'];
        if (
          !Array.isArray(channels) ||
          !channels.length ||
          !channels.every((channel) => isNotificationChannel(channel) && channel !== 'command')
        )
          throw new InputError(
            'channels must be web, email, push, sms, telegram, whatsapp or pushover',
          );
        const announcement = await extras.announcements.create({
          tenantId,
          title: required(text(value.title, 'title', 1, 120).trim(), 'title'),
          message: required(text(value.message, 'message', 1, 2_000).trim(), 'message'),
          channels: [...new Set(channels as NotificationChannel[])],
          createdBy: membership.email ?? membership.userId,
          expiresAtMs: now() + boundedNumber(value.expiresInDays, 7, 1, 90) * DAY,
        });
        await extras.announcementQueue?.publish(tenantId, announcement.announcementId);
        return response(201, announcement);
      }
    }
    return undefined;
  };
}

function required(value: string, name: string) {
  if (!value) throw new InputError(`${name} is invalid`);
  return value;
}

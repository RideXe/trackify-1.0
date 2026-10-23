import type { SNSEvent } from 'aws-lambda';
import {
  createDocumentClient,
  DynamoAdminStore,
  DynamoAnnouncementStore,
  DynamoNotificationStore,
  type Announcement,
  type FleetUser,
} from '@trackify/data';
import { AppSyncPublisher, channels as realtimeChannels } from '@trackify/realtime';
import { liveChannelsFromEnv, type Channels } from './channels';
import { fanOut, type Delivery, type PushRegistry, type WebPublisher } from './fanout';

export interface AnnouncementData extends PushRegistry {
  announcement(tenantId: string, announcementId: string): Promise<Announcement | undefined>;
  users(tenantId: string): Promise<FleetUser[]>;
}

/** Delivers each announcement to every active user of its fleet on the chosen channels. */
export function createAnnouncementHandler(
  data: AnnouncementData,
  channels: Channels,
  web: WebPublisher | undefined,
) {
  return async (event: SNSEvent): Promise<Delivery[]> => {
    const deliveries: Delivery[] = [];
    for (const record of event.Records) {
      const { tenantId, announcementId } = JSON.parse(record.Sns.Message) as {
        tenantId: string;
        announcementId: string;
      };
      const announcement = await data.announcement(tenantId, announcementId);
      if (!announcement) continue;
      const recipients = (await data.users(tenantId)).filter((user) => user.enabled);
      const results = await fanOut(
        { channels, web, push: data },
        {
          tenantId,
          source: announcementId,
          recipients,
          channels: announcement.channels,
          message: {
            title: announcement.title,
            text: `${announcement.title}: ${announcement.message}`,
            html: `<h3>${escape(announcement.title)}</h3><p>${escape(announcement.message).replace(/\n/g, '<br>')}</p>`,
          },
          notification: {
            kind: 'announcement',
            announcementId,
            title: announcement.title,
            text: announcement.message,
          },
        },
      );
      for (const result of results)
        if (result.outcome === 'failed') console.warn('announcement delivery failed', result);
      deliveries.push(...results);
    }
    return deliveries;
  };
}

function escape(value: string) {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}

const client = createDocumentClient();
const core = requiredEnv('CORE_TABLE');
const announcements = new DynamoAnnouncementStore(client, core);
const admin = new DynamoAdminStore(client, core);
const notifications = new DynamoNotificationStore(client, core);
const realtimeDns = process.env.REALTIME_HTTP_DNS;
const publisher = realtimeDns
  ? new AppSyncPublisher(realtimeDns, process.env.AWS_REGION ?? 'ap-south-1')
  : undefined;

export const handler = createAnnouncementHandler(
  {
    announcement: (tenantId, id) => announcements.get(tenantId, id),
    users: (tenantId) => admin.listUsers(tenantId),
    pushTokens: (tenantId, userId) => notifications.listPushTokens(tenantId, userId),
    async forgetPushToken(tenantId, userId, tokenId) {
      await notifications.deletePushToken(tenantId, userId, tokenId);
    },
  },
  liveChannelsFromEnv(),
  publisher && {
    publish: (tenantId, userId, notification) =>
      publisher.publish(realtimeChannels.user(tenantId, userId), notification),
  },
);

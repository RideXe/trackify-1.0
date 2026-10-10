import type { DynamoDBBatchResponse, DynamoDBStreamEvent } from 'aws-lambda';
import { GetCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  createDocumentClient,
  DynamoActivityStore,
  DynamoAdminStore,
  DynamoFleetStore,
  DynamoNotificationStore,
} from '@trackify/data';
import type { EventMessage } from '@trackify/domain';
import { geocoderFromEnv } from '@trackify/geocoder';
import { AppSyncPublisher, channels } from '@trackify/realtime';
import { liveChannelsFromEnv } from './channels';
import { Notifier, type NotifyData, type WebPublisher } from './notifier';

/**
 * Events-table stream consumer. Only infrastructure failures (reading rules or the event) retry the
 * record; a channel that fails is logged and not retried, so nobody gets the same alert twice.
 */
export function createHandler(notifier: Pick<Notifier, 'handle'>) {
  return async (event: DynamoDBStreamEvent): Promise<DynamoDBBatchResponse> => {
    const batchItemFailures: DynamoDBBatchResponse['batchItemFailures'] = [];
    for (const record of event.Records) {
      const pk = record.dynamodb?.Keys?.pk?.S;
      const sk = record.dynamodb?.Keys?.sk?.S;
      if (record.eventName !== 'INSERT' || !pk || !sk) continue;
      try {
        const deliveries = await notifier.handle({ pk, sk });
        for (const delivery of deliveries)
          if (delivery.outcome === 'failed') console.warn('notification failed', delivery);
        if (deliveries.length)
          console.info('notifications', {
            sk,
            sent: deliveries.filter((delivery) => delivery.outcome === 'sent').length,
            skipped: deliveries.filter((delivery) => delivery.outcome === 'skipped').length,
            failed: deliveries.filter((delivery) => delivery.outcome === 'failed').length,
          });
      } catch (error) {
        console.error('notification processing failed', { sk, error });
        const sequenceNumber = record.dynamodb?.SequenceNumber;
        if (sequenceNumber) batchItemFailures.push({ itemIdentifier: sequenceNumber });
        // Stream order matters within a shard: later records retry together with this one.
        break;
      }
    }
    return { batchItemFailures };
  };
}

export function dynamoNotifyData(
  client: DynamoDBDocumentClient,
  tables: { core: string; events: string; positions: string; state: string; commands: string },
): NotifyData {
  const notifications = new DynamoNotificationStore(client, tables.core);
  const admin = new DynamoAdminStore(client, tables.core);
  const activity = new DynamoActivityStore(client, tables.core);
  const fleet = new DynamoFleetStore(client, tables.core, tables.state, tables.positions, {
    events: tables.events,
    trips: '',
    dailyStats: '',
    commands: tables.commands,
  });
  return {
    rules: (tenantId) => notifications.listRules(tenantId),
    async event(key) {
      const result = await client.send(new GetCommand({ TableName: tables.events, Key: key }));
      return result.Item as EventMessage | undefined;
    },
    async device(tenantId, deviceId) {
      const device = await fleet.getDevice(tenantId, deviceId);
      return (
        device && {
          name: device.name,
          groupId: device.groupId,
          driverId: device.driverId,
          speedLimitKmh: device.speedLimitKmh,
        }
      );
    },
    users: (tenantId) => admin.listUsers(tenantId),
    calendar: (tenantId, calendarId) => notifications.getCalendar(tenantId, calendarId),
    timeZone: async (tenantId) => (await activity.organisation(tenantId))?.timeZone,
    geofenceName: async (tenantId, geofenceId) =>
      (await admin.getGeofence(tenantId, geofenceId))?.name,
    async driverName(tenantId, driver) {
      // driverChanged carries the card the tracker read; match it to a driver's RFID.
      const drivers = await fleet.listDrivers(tenantId);
      return drivers.find((item) => item.rfid === driver || item.driverId === driver)?.name;
    },
    async position(tenantId, deviceId, fixTime) {
      const [item] = ((await fleet.positions(tenantId, deviceId, fixTime, fixTime, 1)) ??
        []) as Array<Record<string, unknown>>;
      if (!item || typeof item.latitude !== 'number' || typeof item.longitude !== 'number')
        return undefined;
      return {
        latitude: item.latitude,
        longitude: item.longitude,
        speedKmh: typeof item.speedKmh === 'number' ? item.speedKmh : undefined,
        address: typeof item.address === 'string' ? item.address : undefined,
      };
    },
    pushTokens: (tenantId, userId) => notifications.listPushTokens(tenantId, userId),
    async forgetPushToken(tenantId, userId, tokenId) {
      await notifications.deletePushToken(tenantId, userId, tokenId);
    },
    async createCommand(tenantId, deviceId, command, ruleId) {
      await fleet.createCommand(
        tenantId,
        deviceId,
        `rule:${ruleId}`,
        command.type,
        command.payload,
        Date.now() + 15 * 60_000,
      );
    },
  };
}

function appSyncWebPublisher(httpDns: string, region: string): WebPublisher {
  const publisher = new AppSyncPublisher(httpDns, region);
  return {
    publish: (tenantId, userId, notification) =>
      publisher.publish(channels.user(tenantId, userId), { kind: 'notification', ...notification }),
  };
}

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}

const realtimeDns = process.env.REALTIME_HTTP_DNS;
export const handler = createHandler(
  new Notifier(
    dynamoNotifyData(createDocumentClient(), {
      core: requiredEnv('CORE_TABLE'),
      events: requiredEnv('EVENTS_TABLE'),
      positions: requiredEnv('POSITIONS_TABLE'),
      state: requiredEnv('DEVICE_STATE_TABLE'),
      commands: requiredEnv('COMMANDS_TABLE'),
    }),
    liveChannelsFromEnv(),
    realtimeDns
      ? appSyncWebPublisher(realtimeDns, process.env.AWS_REGION ?? 'ap-south-1')
      : undefined,
    process.env.DASHBOARD_URL,
    Date.now,
    geocoderFromEnv(),
  ),
);

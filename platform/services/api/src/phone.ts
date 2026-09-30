import { createHash } from 'node:crypto';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import {
  createDocumentClient,
  DynamoActivityStore,
  DynamoFleetStore,
  DynamoOnboardingStore,
  type DutyChange,
  type FleetAlert,
  type FleetDevice,
  type OnboardingInvitation,
  type Organisation,
} from '@trackify/data';
import {
  alertFor,
  checkItems,
  defaultPauseLimitMinutes,
  defaultTrackerIntervalSeconds,
  driverActivityTypes,
  dutyAfter,
  isOneOf,
  issueKinds,
  pauseReasons,
  warningKinds,
  type ActivityEntry,
  type ActivityType,
  type CheckItem,
  type CheckResult,
} from '@trackify/domain';
import { ulid } from 'ulid';
import {
  notifierFromEnv,
  photoPrefix,
  photoStoreFromEnv,
  type Notifier,
  type PhotoStore,
} from './aws';
import {
  boundedNumber,
  InputError,
  isRecord,
  jsonObject,
  optionalNumber,
  optionalText,
  requiredEnv,
  response,
} from './http';

interface PhoneDependencies {
  credentials: {
    resolveCredential(
      credentialHash: string,
    ): Promise<Pick<OnboardingInvitation, 'tenantId' | 'deviceId'> | undefined>;
  };
  fleet: {
    getDevice(tenantId: string, deviceId: string): Promise<FleetDevice | undefined>;
    getDriver(tenantId: string, driverId: string): Promise<{ name: string } | undefined>;
    trips(
      tenantId: string,
      deviceId: string,
      from: number,
      to: number,
      limit: number,
    ): Promise<Array<Record<string, unknown>> | undefined>;
  };
  activity: {
    organisation(tenantId: string): Promise<Organisation | undefined>;
    append(
      tenantId: string,
      entry: Omit<ActivityEntry, 'entryId' | 'receivedAt'>,
      now?: number,
    ): Promise<ActivityEntry>;
    list(
      tenantId: string,
      deviceId: string,
      from: number,
      to: number,
      limit: number,
      type?: ActivityType,
    ): Promise<ActivityEntry[]>;
    setDuty(tenantId: string, deviceId: string, duty: DutyChange): Promise<boolean>;
    createAlert(alert: Omit<FleetAlert, 'alertId' | 'status'>): Promise<FleetAlert>;
  };
  photos: PhotoStore;
  notifier?: Notifier;
  dashboardUrl: string;
  now: () => number;
}

/**
 * The driver app's API. Authenticated with the per-phone credential issued when the setup code
 * was redeemed, not a user login; revoking that credential in the dashboard disconnects the phone.
 */
export function createPhoneHandler(deps: PhoneDependencies) {
  return async (event: APIGatewayProxyEventV2) => {
    try {
      const token = bearerToken(event.headers.authorization ?? event.headers.Authorization);
      if (!token) return response(401, { message: 'device credential required' });
      const phone = await deps.credentials.resolveCredential(hash(token));
      if (!phone) return response(401, { message: 'this phone has been disconnected' });
      const { tenantId, deviceId } = phone;
      const device = await deps.fleet.getDevice(tenantId, deviceId);
      if (!device) return response(401, { message: 'this vehicle has been removed' });
      const method = event.requestContext.http.method;
      const path = event.rawPath;
      const now = deps.now();

      if (method === 'GET' && path === '/phone/config') {
        const [organisation, driver] = await Promise.all([
          deps.activity.organisation(tenantId),
          device.driverId ? deps.fleet.getDriver(tenantId, device.driverId) : undefined,
        ]);
        return response(200, {
          organisation: organisation?.name,
          dispatcherPhone: organisation?.dispatcherPhone,
          vehicleName: device.name,
          vehicleType: device.vehicleType,
          driverName: driver?.name,
          trackerIntervalSeconds: device.trackerIntervalSeconds ?? defaultTrackerIntervalSeconds,
          pauseLimitMinutes: device.pauseLimitMinutes ?? defaultPauseLimitMinutes,
          dutyStatus: device.dutyStatus ?? 'off',
          dutySince: device.dutySince,
          pauseReason: device.pauseReason,
          pauseUntil: device.pauseUntil,
        });
      }

      if (method === 'POST' && path === '/phone/activity') {
        const entry = parseActivity(event.body, deviceId, photoPrefix(tenantId, deviceId), now);
        // The pause limit is the administrator's, whatever the phone thinks it is.
        if (entry.type === 'pause')
          entry.until = entry.at + (device.pauseLimitMinutes ?? defaultPauseLimitMinutes) * 60_000;
        const stored = await deps.activity.append(tenantId, entry, now);
        const duty = dutyAfter(stored.type);
        if (duty)
          await deps.activity.setDuty(tenantId, deviceId, {
            dutyStatus: duty,
            dutySince: stored.at,
            pauseReason: stored.type === 'pause' ? (stored.reason ?? null) : null,
            pauseUntil: stored.type === 'pause' ? (stored.until ?? null) : null,
          });
        await raiseAlert(deps, tenantId, device, stored);
        return response(201, stored);
      }

      if (method === 'GET' && path === '/phone/messages') {
        const since = boundedNumber(
          event.queryStringParameters?.since,
          now - 7 * 86_400_000,
          0,
          now,
        );
        const items = await deps.activity.list(tenantId, deviceId, since, now, 50, 'message');
        return response(200, { items });
      }

      if (method === 'POST' && path === '/phone/photos') {
        const photoKey = `${photoPrefix(tenantId, deviceId)}${ulid(now)}.jpg`;
        return response(201, { photoKey, uploadUrl: await deps.photos.uploadUrl(photoKey) });
      }

      if (method === 'GET' && path === '/phone/today') {
        // The phone sends its own local midnight, so "today" matches the driver's clock.
        const from = boundedNumber(
          event.queryStringParameters?.from,
          now - 86_400_000,
          now - 2 * 86_400_000,
          now,
        );
        const trips = (await deps.fleet.trips(tenantId, deviceId, from, now, 500)) ?? [];
        let distanceM = 0;
        let drivingMs = 0;
        for (const trip of trips) {
          distanceM += Number(trip.distanceM ?? 0);
          const start = Number(trip.startTime);
          const end = Number(trip.endTime);
          if (Number.isFinite(start) && Number.isFinite(end) && end > start)
            drivingMs += end - start;
        }
        return response(200, { trips: trips.length, distanceM, drivingMs });
      }

      return response(404, { message: 'route not found' });
    } catch (error) {
      if (error instanceof InputError) return response(400, { message: error.message });
      console.error('phone request failed', error);
      return response(503, { message: 'temporarily unavailable' });
    }
  };
}

async function raiseAlert(
  deps: PhoneDependencies,
  tenantId: string,
  device: FleetDevice,
  entry: ActivityEntry,
) {
  const alert = alertFor(entry);
  if (!alert) return;
  await deps.activity.createAlert({
    tenantId,
    deviceId: device.deviceId,
    deviceName: device.name,
    entryId: entry.entryId,
    type: entry.type,
    kind: entry.kind,
    severity: alert.severity,
    createdAt: entry.receivedAt,
    latitude: entry.latitude,
    longitude: entry.longitude,
    note: entry.note,
  });
  if (!alert.email || !deps.notifier) return;
  const [organisation, driver] = await Promise.all([
    deps.activity.organisation(tenantId),
    device.driverId ? deps.fleet.getDriver(tenantId, device.driverId) : undefined,
  ]);
  const what = entry.type === 'sos' ? 'SOS emergency' : `Reported ${entry.kind ?? 'issue'}`;
  const lines = [
    `${what} from ${device.name}${organisation?.name ? ` (${organisation.name})` : ''}.`,
    '',
    `Driver: ${driver?.name ?? 'no driver assigned'}`,
    `When: ${new Date(entry.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`,
    entry.latitude !== undefined && entry.longitude !== undefined
      ? `Where: https://maps.google.com/?q=${entry.latitude},${entry.longitude}`
      : 'Where: the phone had no location fix',
    entry.batteryPct !== undefined ? `Phone battery: ${entry.batteryPct}%` : '',
    entry.note ? `Note: ${entry.note}` : '',
    '',
    `Open the vehicle: ${deps.dashboardUrl.replace(/\/$/, '')}/?vehicle=${encodeURIComponent(device.deviceId)}`,
  ].filter((line, index, all) => line !== '' || all[index - 1] !== '');
  try {
    await deps.notifier.send(`Trackify: ${what} · ${device.name}`, lines.join('\n'));
  } catch (error) {
    // The alert is already on the dashboard; a failed email must not make the phone retry it.
    console.error('alert email failed', error);
  }
}

/** One driver entry, validated field by field for its type. Unknown fields are dropped. */
export function parseActivity(
  body: string | undefined,
  deviceId: string,
  photoKeyPrefix: string,
  now: number,
): Omit<ActivityEntry, 'entryId' | 'receivedAt'> {
  const value = jsonObject(body);
  if (!isOneOf(driverActivityTypes, value.type)) throw new InputError('type is unsupported');
  const type = value.type;
  // Entries queued offline arrive late, but never from far in the past or the future.
  const at = optionalNumber(value.at, 'at', now - 7 * 86_400_000, now + 300_000) ?? now;
  const entry: Omit<ActivityEntry, 'entryId' | 'receivedAt'> = {
    deviceId,
    type,
    at: Math.round(at),
    latitude: optionalNumber(value.latitude, 'latitude', -90, 90),
    longitude: optionalNumber(value.longitude, 'longitude', -180, 180),
    batteryPct: optionalNumber(value.batteryPct, 'batteryPct', 0, 100),
    note: optionalText(value.note, 'note', 1, 500),
  };
  if ((entry.latitude === undefined) !== (entry.longitude === undefined))
    throw new InputError('latitude and longitude go together');
  if (value.photoKey !== undefined) {
    if (type !== 'issue' && type !== 'fuel') throw new InputError('photoKey is not expected');
    if (
      typeof value.photoKey !== 'string' ||
      !value.photoKey.startsWith(photoKeyPrefix) ||
      !/^[\w/.-]+$/.test(value.photoKey)
    )
      throw new InputError('photoKey is invalid');
    entry.photoKey = value.photoKey;
  }
  if (type === 'pause') {
    if (!isOneOf(pauseReasons, value.reason)) throw new InputError('reason is unsupported');
    entry.reason = value.reason;
  }
  if (type === 'resume' && value.auto !== undefined) {
    if (typeof value.auto !== 'boolean') throw new InputError('auto is invalid');
    entry.auto = value.auto;
  }
  if (type === 'issue') {
    if (!isOneOf(issueKinds, value.kind)) throw new InputError('kind is unsupported');
    entry.kind = value.kind;
  }
  if (type === 'warning') {
    if (!isOneOf(warningKinds, value.kind)) throw new InputError('kind is unsupported');
    entry.kind = value.kind;
  }
  if (type === 'fuel') {
    entry.litres = optionalNumber(value.litres, 'litres', 0.1, 1_000);
    if (entry.litres === undefined) throw new InputError('litres is required');
    entry.amount = optionalNumber(value.amount, 'amount', 0, 1_000_000);
    entry.odometerKm = optionalNumber(value.odometerKm, 'odometerKm', 0, 10_000_000);
  }
  if (type === 'check') {
    if (!isRecord(value.items)) throw new InputError('items are required');
    const items: Partial<Record<CheckItem, CheckResult>> = {};
    for (const [item, result] of Object.entries(value.items)) {
      if (!isOneOf(checkItems, item) || (result !== 'ok' && result !== 'issue'))
        throw new InputError('items are invalid');
      items[item] = result;
    }
    if (!Object.keys(items).length) throw new InputError('items are required');
    entry.items = items;
  }
  return entry;
}

function bearerToken(header: string | undefined) {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

const client = createDocumentClient();
const coreTable = requiredEnv('CORE_TABLE');
export const handler = createPhoneHandler({
  credentials: new DynamoOnboardingStore(client, requiredEnv('ONBOARDING_TABLE')),
  fleet: new DynamoFleetStore(
    client,
    coreTable,
    requiredEnv('DEVICE_STATE_TABLE'),
    requiredEnv('POSITIONS_TABLE'),
    {
      events: requiredEnv('EVENTS_TABLE'),
      trips: requiredEnv('TRIPS_TABLE'),
      dailyStats: requiredEnv('DAILY_STATS_TABLE'),
      commands: requiredEnv('COMMANDS_TABLE'),
    },
  ),
  activity: new DynamoActivityStore(client, coreTable),
  photos: photoStoreFromEnv(requiredEnv('PHOTOS_BUCKET')),
  notifier: process.env.ALERTS_TOPIC_ARN
    ? notifierFromEnv(process.env.ALERTS_TOPIC_ARN)
    : undefined,
  dashboardUrl: requiredEnv('DASHBOARD_URL'),
  now: Date.now,
});

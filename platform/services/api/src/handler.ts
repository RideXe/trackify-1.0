import { createHash, randomInt } from 'node:crypto';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import {
  createDocumentClient,
  DynamoActivityStore,
  DynamoAdminStore,
  DynamoAnnouncementStore,
  DynamoAuditStore,
  DynamoShareStore,
  type AuditEntry,
  DynamoNotificationStore,
  DynamoReportStore,
  DynamoFleetStore,
  DynamoOnboardingStore,
  type DeviceProximity,
  type FleetAlert,
  type Membership,
  type OnboardingInvitation,
  type Organisation,
} from '@trackify/data';
import {
  defaultSubscriptionPlan,
  defaultVehicleType,
  effectiveTrackerInterval,
  fastestIntervalFor,
  isFuelType,
  isSubscriptionPlan,
  isTimeZone,
  isVehicleType,
  pauseLimits,
  trackerIntervals,
  type ActivityEntry,
  type ActivityType,
  type FuelType,
  type PositionMessage,
  type VehicleType,
} from '@trackify/domain';
import {
  createAdminRoutes,
  limitedToGroups,
  requireGroups,
  sees,
  UNGROUPED,
  type AdminStore,
} from './admin';
import {
  announcementQueueFromEnv,
  identityDirectoryFromEnv,
  photoPrefix,
  photoStoreFromEnv,
  type IdentityDirectory,
  type PhotoStore,
} from './aws';
import { geocoderFromEnv, type Geocoder } from '@trackify/geocoder';
import { isTrackerProtocol } from '@trackify/protocols/ports';
import { createConfigRoutes, type ConfigStore } from './config-routes';
import { createNotificationRoutes, type NotificationStore } from './notifications';
import {
  createExtraRoutes,
  type AnnouncementQueue,
  type Announcements,
  type AuditLog,
  type ShareStore,
} from './extras';
import { createReportRoutes, type csv, type ReportStore } from './reports';
import {
  boundedNumber,
  clearable,
  InputError,
  isRecord,
  jsonObject,
  optionalText,
  requiredEnv,
  response,
  text,
} from './http';

interface FleetStore {
  membership(subject: string): Promise<Membership | undefined>;
  listDevices(
    tenantId: string,
  ): Promise<Array<{ deviceId: string; name?: string; driverId?: string; groupId?: string }>>;
  createDevice(tenantId: string, input: DeviceInput): Promise<unknown>;
  updateDevice(tenantId: string, deviceId: string, changes: DeviceChanges): Promise<unknown>;
  deleteDevice(tenantId: string, deviceId: string): Promise<boolean>;
  listDrivers(tenantId: string): Promise<unknown[]>;
  getDriver(tenantId: string, driverId: string): Promise<unknown>;
  createDriver(tenantId: string, input: DriverInput): Promise<unknown>;
  updateDriver(tenantId: string, driverId: string, changes: DriverChanges): Promise<unknown>;
  deleteDriver(tenantId: string, driverId: string): Promise<boolean>;
  getDevice(
    tenantId: string,
    deviceId: string,
  ): Promise<
    | {
        deviceId: string;
        name: string;
        uniqueId: string;
        protocol: string;
        retentionDays: number;
        groupId?: string;
      }
    | undefined
  >;
  positions(
    tenantId: string,
    deviceId: string,
    from: number,
    to: number,
    limit: number,
  ): Promise<unknown[] | undefined>;
  events(
    tenantId: string,
    deviceId: string,
    from: number,
    to: number,
    limit: number,
  ): Promise<unknown[] | undefined>;
  trips(
    tenantId: string,
    deviceId: string,
    from: number,
    to: number,
    limit: number,
  ): Promise<unknown[] | undefined>;
  dailyStats(
    tenantId: string,
    deviceId: string,
    fromDay: string,
    toDay: string,
  ): Promise<unknown[] | undefined>;
  tenantEvents(tenantId: string, from: number, to: number, limit: number): Promise<unknown[]>;
  createCommand(
    tenantId: string,
    deviceId: string,
    requestedBy: string,
    type: string,
    payload: Record<string, unknown>,
    expiresAtMs: number,
  ): Promise<Record<string, unknown> | undefined>;
}

interface ActivityStore {
  organisation(tenantId: string): Promise<Organisation | undefined>;
  updateOrganisation(
    tenantId: string,
    changes: {
      name?: string;
      dispatcherPhone?: string | null;
      timeZone?: string;
      trackerIntervalSeconds?: number | null;
    },
  ): Promise<Organisation | undefined>;
  append(
    tenantId: string,
    entry: Omit<ActivityEntry, 'entryId' | 'receivedAt'>,
  ): Promise<ActivityEntry>;
  list(
    tenantId: string,
    deviceId: string,
    from: number,
    to: number,
    limit: number,
    type?: ActivityType,
  ): Promise<ActivityEntry[]>;
  listAlerts(tenantId: string, limit?: number): Promise<FleetAlert[]>;
  getAlert(tenantId: string, alertId: string): Promise<FleetAlert | undefined>;
  acknowledgeAlert(tenantId: string, alertId: string, by: string): Promise<FleetAlert | undefined>;
}

interface InvitationStore {
  create(invitation: OnboardingInvitation): Promise<OnboardingInvitation>;
  list(tenantId: string, deviceId: string): Promise<OnboardingInvitation[]>;
  revoke(tenantId: string, codeHash: string): Promise<boolean>;
}

interface DeviceInput {
  name: string;
  uniqueId: string;
  protocol: string;
  retentionDays: number;
  groupId: string;
  vehicleType: VehicleType;
  model?: string;
  fuelType?: FuelType;
  purchasedOn?: string;
  colour?: string;
}

/** null clears an optional field (or unassigns the driver); undefined leaves it as it is. */
interface DeviceChanges {
  name?: string;
  vehicleType?: VehicleType;
  groupId?: string;
  model?: string | null;
  fuelType?: FuelType | null;
  purchasedOn?: string | null;
  colour?: string | null;
  driverId?: string | null;
  speedLimitKmh?: number | null;
  fuelDropThreshold?: number | null;
  fuelIncreaseThreshold?: number | null;
  accelerationThresholdMs2?: number | null;
  brakingThresholdMs2?: number | null;
  proximity?: DeviceProximity | null;
  accumulators?: { odometerM?: number; engineHoursS?: number; setAt: number };
  trackerIntervalSeconds?: number;
  pauseLimitMinutes?: number;
}

interface DriverInput {
  name: string;
  phone?: string;
  licenceNumber?: string;
  rfid?: string;
}

interface DriverChanges {
  name?: string;
  phone?: string | null;
  licenceNumber?: string | null;
  rfid?: string | null;
}

/** Fleet configuration beyond vehicles and drivers; each part is optional so tests can omit it. */
export interface FleetAdministration {
  admin?: AdminStore & Partial<ConfigStore>;
  identity?: IdentityDirectory;
  notifications?: NotificationStore;
  reports?: ReportStore;
  geocoder?: Geocoder;
  shares?: ShareStore;
  audit?: AuditLog & {
    record(tenantId: string, entry: Omit<AuditEntry, 'auditId'>): Promise<void>;
  };
  announcements?: Announcements;
  announcementQueue?: AnnouncementQueue;
}

export function createHandler(
  store: FleetStore,
  invitations?: InvitationStore,
  onboardingWebUrl = 'https://trackify.invalid',
  activity?: ActivityStore,
  photos?: PhotoStore,
  {
    admin,
    identity,
    notifications,
    reports,
    geocoder,
    shares,
    audit,
    announcements,
    announcementQueue,
  }: FleetAdministration = {},
) {
  const adminRoutes = admin && createAdminRoutes(admin, store, identity);
  const notificationRoutes =
    admin &&
    notifications &&
    createNotificationRoutes(notifications, {
      // Delegates, not spreads: the stores are class instances with prototype methods.
      listDevices: (tenantId) => store.listDevices(tenantId),
      listGroups: (tenantId) => admin.listGroups(tenantId),
      listUsers: (tenantId) => admin.listUsers(tenantId),
    });
  const configRoutes =
    admin?.listComputed &&
    createConfigRoutes(admin as AdminStore & ConfigStore, {
      latest: async (tenantId, deviceId) =>
        ((await store.positions(tenantId, deviceId, 0, Date.now() + 300_000, 1)) ?? [])[0] as
          PositionMessage | undefined,
    });
  const extraRoutes =
    admin &&
    activity &&
    createExtraRoutes(
      {
        getDevice: (tenantId, deviceId) => store.getDevice(tenantId, deviceId),
        listDevices: (tenantId) => store.listDevices(tenantId),
        listUsers: (tenantId) => admin.listUsers(tenantId),
        tenantEvents: (...args) => store.tenantEvents(...args),
        openAlerts: async (tenantId) =>
          (await activity.listAlerts(tenantId)).filter((alert) => alert.status === 'open').length,
      },
      { shares, audit, announcements, announcementQueue, shareBaseUrl: onboardingWebUrl },
    );
  const reportRoutes =
    admin &&
    activity &&
    createReportRoutes(
      {
        getDevice: (tenantId, deviceId) => store.getDevice(tenantId, deviceId),
        listDevices: (tenantId) => store.listDevices(tenantId),
        positions: (...args) => store.positions(...args),
        events: (...args) => store.events(...args),
        trips: (...args) => store.trips(...args),
        dailyStats: (...args) => store.dailyStats(...args),
        tenantEvents: (...args) => store.tenantEvents(...args),
        listGeofences: (tenantId) => admin.listGeofences(tenantId),
        listGroups: (tenantId) => admin.listGroups(tenantId),
        listUsers: (tenantId) => admin.listUsers(tenantId),
        timeZone: async (tenantId) => (await activity.organisation(tenantId))?.timeZone,
      },
      reports,
    );
  const route = async (
    event: APIGatewayProxyEventV2WithJWTAuthorizer,
    membership: Membership,
    method: string,
    path: string,
  ): Promise<ReturnType<typeof response> | ReturnType<typeof csv>> => {
    if (method === 'GET' && path === '/me') {
      const user = await admin?.getUser(membership.tenantId, membership.userId);
      const { phone, telegramChatId, pushoverUserKey } = user ?? {};
      return response(200, { ...membership, phone, telegramChatId, pushoverUserKey });
    }
    const adminResponse =
      (await adminRoutes?.(event, membership)) ??
      (await notificationRoutes?.(event, membership)) ??
      (await configRoutes?.(event, membership)) ??
      (await extraRoutes?.(event, membership));
    if (adminResponse) return adminResponse;
    // A dispatcher or viewer limited to groups sees other groups' vehicles as not existing.
    const scopedDevice = path.match(/^\/devices\/([^/]+)\/[a-z-]+(?:\/[^/]+)?$/);
    if (scopedDevice?.[1] && limitedToGroups(membership)) {
      const device = await store.getDevice(membership.tenantId, scopedDevice[1]);
      if (!device || !sees(membership, device.groupId))
        return response(404, { message: 'device not found' });
    }
    const reportResponse = await reportRoutes?.(event, membership);
    if (reportResponse) return reportResponse;
    if (method === 'GET' && path === '/geocode') {
      const latitude = Number(event.queryStringParameters?.latitude);
      const longitude = Number(event.queryStringParameters?.longitude);
      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        Math.abs(latitude) > 90 ||
        Math.abs(longitude) > 180
      )
        throw new InputError('latitude and longitude are required');
      // The dashboard shows it and does not keep it: a display licence.
      return response(200, {
        address: (await geocoder?.address(latitude, longitude, 'display')) ?? null,
      });
    }
    if (method === 'GET' && path === '/devices') {
      const [devices, organisation] = await Promise.all([
        store.listDevices(membership.tenantId),
        activity?.organisation(membership.tenantId),
      ]);
      return response(200, {
        items: devices
          .filter((device) => sees(membership, device.groupId))
          .map((device) => ({
            ...device,
            // What the phone actually uses after the fleet default and the plan limit.
            effectiveTrackerIntervalSeconds: effectiveTrackerInterval({
              vehicle: (device as { trackerIntervalSeconds?: number }).trackerIntervalSeconds,
              fleet: organisation?.trackerIntervalSeconds,
              plan: organisation?.plan,
            }),
          })),
      });
    }
    if (method === 'POST' && path === '/devices') {
      if (membership.role !== 'admin') return response(403, { message: 'admin role required' });
      const input = parseDevice(event.body);
      if (admin) await requireGroups(admin, membership.tenantId, [input.groupId]);
      const device = await store.createDevice(membership.tenantId, input);
      if (input.protocol !== 'osmand' || !invitations) return response(201, device);
      const onboarding = await createInvitation(
        invitations,
        membership.tenantId,
        device as { deviceId: string; name: string; uniqueId: string; retentionDays: number },
        onboardingWebUrl,
      );
      return response(201, { ...(device as object), onboarding });
    }
    const accumulatorMatch = path.match(/^\/devices\/([^/]+)\/accumulators$/);
    if (method === 'POST' && accumulatorMatch?.[1]) {
      if (membership.role !== 'admin') return response(403, { message: 'admin role required' });
      const accumulators = parseAccumulators(event.body, Date.now());
      const device = await store.updateDevice(membership.tenantId, accumulatorMatch[1], {
        accumulators,
      });
      // Processing applies the correction with the vehicle's next position.
      return device
        ? response(202, { accumulators })
        : response(404, { message: 'device not found' });
    }
    const deviceMatch = path.match(/^\/devices\/([^/]+)$/);
    if (method === 'PATCH' && deviceMatch?.[1]) {
      if (membership.role !== 'admin') return response(403, { message: 'admin role required' });
      const changes = parseDeviceChanges(event.body);
      if (changes.trackerIntervalSeconds !== undefined && activity)
        requireAllowedInterval(
          changes.trackerIntervalSeconds,
          await activity.organisation(membership.tenantId),
        );
      if (changes.driverId && !(await store.getDriver(membership.tenantId, changes.driverId)))
        return response(400, { message: 'driverId does not match a driver' });
      if (changes.groupId && admin)
        await requireGroups(admin, membership.tenantId, [changes.groupId]);
      if (changes.proximity) {
        const known = new Set(
          (await store.listDevices(membership.tenantId)).map((device) => device.deviceId),
        );
        const linked = changes.proximity.linkedDeviceIds;
        if (linked.includes(deviceMatch[1]))
          return response(400, { message: 'a vehicle cannot be linked to itself' });
        const unknown = linked.filter((id) => !known.has(id));
        if (unknown.length)
          return response(400, { message: `unknown vehicles: ${unknown.join(', ')}` });
      }
      const device = await store.updateDevice(membership.tenantId, deviceMatch[1], changes);
      return device ? response(200, device) : response(404, { message: 'device not found' });
    }
    if (method === 'DELETE' && deviceMatch?.[1]) {
      if (membership.role !== 'admin') return response(403, { message: 'admin role required' });
      const deleted = await store.deleteDevice(membership.tenantId, deviceMatch[1]);
      return deleted ? response(204, undefined) : response(404, { message: 'device not found' });
    }
    if (method === 'GET' && path === '/drivers') {
      return response(200, { items: await store.listDrivers(membership.tenantId) });
    }
    if (method === 'POST' && path === '/drivers') {
      if (membership.role !== 'admin') return response(403, { message: 'admin role required' });
      const input = parseDriverInput(event.body);
      if (input.rfid && (await rfidTaken(store, membership.tenantId, input.rfid)))
        return response(409, { message: 'another driver already has this RFID card' });
      return response(201, await store.createDriver(membership.tenantId, input));
    }
    const driverMatch = path.match(/^\/drivers\/([^/]+)$/);
    if (method === 'PATCH' && driverMatch?.[1]) {
      if (membership.role !== 'admin') return response(403, { message: 'admin role required' });
      const changes = parseDriverChanges(event.body);
      if (
        changes.rfid &&
        (await rfidTaken(store, membership.tenantId, changes.rfid, driverMatch[1]))
      )
        return response(409, { message: 'another driver already has this RFID card' });
      const driver = await store.updateDriver(membership.tenantId, driverMatch[1], changes);
      return driver ? response(200, driver) : response(404, { message: 'driver not found' });
    }
    if (method === 'DELETE' && driverMatch?.[1]) {
      if (membership.role !== 'admin') return response(403, { message: 'admin role required' });
      const driverId = driverMatch[1];
      const deleted = await store.deleteDriver(membership.tenantId, driverId);
      if (!deleted) return response(404, { message: 'driver not found' });
      // A removed driver must not stay on the vehicles they drove.
      const assigned = (await store.listDevices(membership.tenantId)).filter(
        (device) => device.driverId === driverId,
      );
      await Promise.all(
        assigned.map((device) =>
          store.updateDevice(membership.tenantId, device.deviceId, { driverId: null }),
        ),
      );
      return response(204, undefined);
    }
    if (path === '/organisation' || path === '/alerts' || path.startsWith('/alerts/')) {
      if (!activity) return response(503, { message: 'activity unavailable' });
    }
    if (method === 'GET' && path === '/organisation') {
      const organisation = await activity!.organisation(membership.tenantId);
      return organisation
        ? response(200, withPlan(organisation))
        : response(404, { message: 'organisation not found' });
    }
    if (method === 'PATCH' && path === '/organisation') {
      if (membership.role !== 'admin') return response(403, { message: 'admin role required' });
      const changes = parseOrganisationChanges(event.body);
      if (typeof changes.trackerIntervalSeconds === 'number')
        requireAllowedInterval(
          changes.trackerIntervalSeconds,
          await activity!.organisation(membership.tenantId),
        );
      const organisation = await activity!.updateOrganisation(membership.tenantId, changes);
      return organisation
        ? response(200, withPlan(organisation))
        : response(404, { message: 'organisation not found' });
    }
    if (method === 'GET' && path === '/alerts') {
      const alerts = await activity!.listAlerts(membership.tenantId);
      if (!limitedToGroups(membership)) return response(200, { items: alerts });
      const visible = new Set(
        (await store.listDevices(membership.tenantId))
          .filter((device) => sees(membership, device.groupId))
          .map((device) => device.deviceId),
      );
      return response(200, { items: alerts.filter((alert) => visible.has(alert.deviceId)) });
    }
    const alertMatch = path.match(/^\/alerts\/([0-9A-HJKMNP-TV-Z]{26})$/);
    if (method === 'PATCH' && alertMatch?.[1]) {
      if (membership.role === 'viewer')
        return response(403, { message: 'dispatcher role required' });
      const body = jsonObject(event.body);
      if (body.status !== 'acknowledged') throw new InputError('status must be acknowledged');
      if (limitedToGroups(membership)) {
        const existing = await activity!.getAlert(membership.tenantId, alertMatch[1]);
        const device = existing && (await store.getDevice(membership.tenantId, existing.deviceId));
        if (!device || !sees(membership, device.groupId))
          return response(404, { message: 'alert not found' });
      }
      const alert = await activity!.acknowledgeAlert(
        membership.tenantId,
        alertMatch[1],
        membership.email ?? membership.userId,
      );
      return alert ? response(200, alert) : response(404, { message: 'alert not found' });
    }
    const activityMatch = path.match(/^\/devices\/([^/]+)\/(activity|messages)$/);
    if (activityMatch?.[1]) {
      if (!activity) return response(503, { message: 'activity unavailable' });
      const deviceId = activityMatch[1];
      if (!(await store.getDevice(membership.tenantId, deviceId)))
        return response(404, { message: 'device not found' });
      if (method === 'GET' && activityMatch[2] === 'activity') {
        const now = Date.now();
        const from = boundedNumber(event.queryStringParameters?.from, now - 7 * 86_400_000, 0, now);
        const to = boundedNumber(event.queryStringParameters?.to, now, from, now + 300_000);
        const items = await activity.list(membership.tenantId, deviceId, from, to, 200);
        const prefix = photoPrefix(membership.tenantId, deviceId);
        return response(200, {
          items: await Promise.all(
            items.map(async (item) =>
              item.photoKey?.startsWith(prefix) && photos
                ? { ...item, photoUrl: await photos.viewUrl(item.photoKey) }
                : item,
            ),
          ),
        });
      }
      if (method === 'POST' && activityMatch[2] === 'messages') {
        if (membership.role === 'viewer')
          return response(403, { message: 'dispatcher role required' });
        const message = text(jsonObject(event.body).text, 'text', 1, 500).trim();
        if (!message) throw new InputError('text is invalid');
        const entry = await activity.append(membership.tenantId, {
          deviceId,
          type: 'message',
          at: Date.now(),
          text: message,
          sentBy: membership.email ?? membership.userId,
        });
        return response(201, entry);
      }
    }
    const invitationMatch = path.match(/^\/devices\/([^/]+)\/invitations$/);
    if (invitationMatch?.[1] && method === 'GET') {
      if (!invitations) return response(503, { message: 'onboarding unavailable' });
      const device = await store.getDevice(membership.tenantId, invitationMatch[1]);
      if (!device) return response(404, { message: 'device not found' });
      const items = await invitations.list(membership.tenantId, device.deviceId);
      return response(200, { items: items.map(publicInvitation) });
    }
    if (invitationMatch?.[1] && method === 'POST') {
      if (membership.role !== 'admin') return response(403, { message: 'admin role required' });
      if (!invitations) return response(503, { message: 'onboarding unavailable' });
      const device = await store.getDevice(membership.tenantId, invitationMatch[1]);
      if (!device) return response(404, { message: 'device not found' });
      return response(
        201,
        await createInvitation(invitations, membership.tenantId, device, onboardingWebUrl),
      );
    }
    const revokeMatch = path.match(/^\/invitations\/([a-f0-9]{64})$/);
    if (revokeMatch?.[1] && method === 'DELETE') {
      if (membership.role !== 'admin') return response(403, { message: 'admin role required' });
      if (!invitations) return response(503, { message: 'onboarding unavailable' });
      const revoked = await invitations.revoke(membership.tenantId, revokeMatch[1]);
      return revoked ? response(204, undefined) : response(404, { message: 'invite not found' });
    }
    const match = path.match(/^\/devices\/([^/]+)\/positions$/);
    if (method === 'GET' && match?.[1]) {
      const now = Date.now();
      const from = boundedNumber(event.queryStringParameters?.from, now - 86_400_000, 0, now);
      const to = boundedNumber(event.queryStringParameters?.to, now, from, now + 300_000);
      const limit = boundedNumber(event.queryStringParameters?.limit, 1_000, 1, 5_000);
      const items = await store.positions(membership.tenantId, match[1], from, to, limit);
      return items ? response(200, { items }) : response(404, { message: 'device not found' });
    }
    const reportMatch = path.match(/^\/devices\/([^/]+)\/(events|trips)$/);
    if (method === 'GET' && reportMatch?.[1] && reportMatch[2]) {
      const now = Date.now();
      const from = boundedNumber(event.queryStringParameters?.from, now - 86_400_000, 0, now);
      const to = boundedNumber(event.queryStringParameters?.to, now, from, now + 300_000);
      const limit = boundedNumber(event.queryStringParameters?.limit, 1_000, 1, 5_000);
      const items =
        reportMatch[2] === 'events'
          ? await store.events(membership.tenantId, reportMatch[1], from, to, limit)
          : await store.trips(membership.tenantId, reportMatch[1], from, to, limit);
      return items ? response(200, { items }) : response(404, { message: 'device not found' });
    }
    if (method === 'GET' && path === '/trips') {
      const now = Date.now();
      const from = boundedNumber(event.queryStringParameters?.from, now - 86_400_000, 0, now);
      // A month at most: every vehicle is queried separately.
      const to = boundedNumber(
        event.queryStringParameters?.to,
        now,
        from,
        Math.min(now + 300_000, from + 31 * 86_400_000),
      );
      const only = event.queryStringParameters?.deviceId;
      const devices = (await store.listDevices(membership.tenantId)).filter(
        (device) => (!only || device.deviceId === only) && sees(membership, device.groupId),
      );
      const perDevice = 1_000;
      let truncated = false;
      const items: Array<Record<string, unknown>> = [];
      // A few vehicles at a time keeps a large fleet from bursting the table's read capacity.
      for (let index = 0; index < devices.length; index += 10) {
        const batch = devices.slice(index, index + 10);
        const results = await Promise.all(
          batch.map((device) =>
            store.trips(membership.tenantId, device.deviceId, from, to, perDevice),
          ),
        );
        results.forEach((trips, position) => {
          const device = batch[position]!;
          if ((trips?.length ?? 0) >= perDevice) truncated = true;
          for (const trip of (trips ?? []) as Array<Record<string, unknown>>)
            items.push({
              tripId: trip.tripId,
              deviceId: device.deviceId,
              deviceName: device.name,
              startTime: trip.startTime,
              endTime: trip.endTime,
              distanceM: trip.distanceM,
              maxSpeedKmh: trip.maxSpeedKmh,
              startLatitude: trip.startLatitude,
              startLongitude: trip.startLongitude,
              endLatitude: trip.endLatitude,
              endLongitude: trip.endLongitude,
            });
        });
      }
      items.sort((a, b) => Number(b.startTime) - Number(a.startTime));
      return response(200, { items, truncated });
    }
    const summaryMatch = path.match(/^\/devices\/([^/]+)\/summary$/);
    if (method === 'GET' && summaryMatch?.[1]) {
      const today = new Date().toISOString().slice(0, 10);
      const from = day(event.queryStringParameters?.from ?? today);
      const to = day(event.queryStringParameters?.to ?? today);
      const items = await store.dailyStats(membership.tenantId, summaryMatch[1], from, to);
      return items ? response(200, { items }) : response(404, { message: 'device not found' });
    }
    const commandMatch = path.match(/^\/devices\/([^/]+)\/commands$/);
    if (method === 'POST' && commandMatch?.[1]) {
      if (membership.role === 'viewer')
        return response(403, { message: 'command permission required' });
      const command = parseCommand(event.body, membership.role);
      const created = await store.createCommand(
        membership.tenantId,
        commandMatch[1],
        membership.userId,
        command.type,
        command.payload,
        Date.now() + command.ttlSeconds * 1000,
      );
      return created ? response(202, created) : response(404, { message: 'device not found' });
    }
    return response(404, { message: 'route not found' });
  };
  return async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
    try {
      const subject = event.requestContext.authorizer.jwt.claims.sub;
      if (typeof subject !== 'string') return response(401, { message: 'invalid identity' });
      const membership = await store.membership(subject);
      if (!membership) return response(403, { message: 'fleet membership required' });
      const method = event.requestContext.http.method;
      const path = event.rawPath;
      const result = await route(event, membership, method, path);
      if (audit && method !== 'GET' && result.statusCode < 400)
        await audit
          .record(membership.tenantId, {
            at: Date.now(),
            userId: membership.userId,
            email: membership.email,
            method,
            path,
            status: result.statusCode,
          })
          // A missed audit entry is logged; it must not undo a change that already happened.
          .catch((error: unknown) => console.error('audit record failed', error));
      return result;
    } catch (error) {
      if (error instanceof InputError) return response(400, { message: error.message });
      if (isTransactionConflict(error))
        return response(409, { message: 'uniqueId already exists' });
      console.error('api request failed', error);
      return response(503, { message: 'temporarily unavailable' });
    }
  };
}

async function createInvitation(
  invitations: InvitationStore,
  tenantId: string,
  device: { deviceId: string; name: string; uniqueId: string; retentionDays: number },
  onboardingWebUrl: string,
) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const code = randomCode();
    const codeHash = hash(code);
    const createdAt = Date.now();
    try {
      await invitations.create({
        codeHash,
        tenantId,
        deviceId: device.deviceId,
        deviceName: device.name,
        uniqueId: device.uniqueId,
        retentionDays: device.retentionDays,
        status: 'waiting',
        createdAt,
        expiresAt: Math.floor(createdAt / 1000) + 86_400,
      });
      return {
        invitationId: codeHash,
        code,
        link: `${onboardingWebUrl.replace(/\/$/, '')}/onboard/#${code}`,
        status: 'waiting',
        createdAt,
        expiresAt: Math.floor(createdAt / 1000) + 86_400,
      };
    } catch (error) {
      if (!isCodeConflict(error) || attempt === 3) throw error;
    }
  }
  throw new Error('unable to allocate onboarding code');
}

function publicInvitation(invitation: OnboardingInvitation) {
  const expired =
    invitation.status === 'waiting' &&
    invitation.expiresAt !== undefined &&
    invitation.expiresAt <= Math.floor(Date.now() / 1000);
  return {
    invitationId: invitation.codeHash,
    status: expired ? 'expired' : invitation.status,
    createdAt: invitation.createdAt,
    expiresAt: invitation.expiresAt,
    activatedAt: invitation.activatedAt,
  };
}

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('');
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function parseCommand(body: string | undefined, role: Membership['role']) {
  if (!body) throw new InputError('request body is required');
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new InputError('request body must be JSON');
  }
  if (!isRecord(value)) throw new InputError('request body must be an object');
  const type = text(value.type, 'type', 2, 32);
  if (!['engineStop', 'engineResume', 'custom'].includes(type))
    throw new InputError('command type is unsupported');
  if ((type === 'engineStop' || type === 'engineResume') && role !== 'admin')
    throw new InputError('engine commands require an administrator');
  const ttlSeconds = boundedNumber(value.ttlSeconds, 300, 30, 900);
  const payload = isRecord(value.payload) ? value.payload : {};
  return { type, ttlSeconds, payload };
}

function day(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new InputError('date must be YYYY-MM-DD');
  return value;
}

function vehicleType(value: unknown): VehicleType {
  if (!isVehicleType(value)) throw new InputError('vehicleType is unsupported');
  return value;
}

function fuelType(value: unknown): FuelType {
  if (!isFuelType(value)) throw new InputError('fuelType is unsupported');
  return value;
}

/** A real calendar day: 2026-02-30 matches the pattern but Date rolls it over to March. */
function purchasedOn(value: unknown): string {
  const date = typeof value === 'string' ? new Date(`${value}T00:00:00Z`) : undefined;
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !date ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new InputError('purchasedOn must be an ISO date (YYYY-MM-DD)');
  return value;
}

function parseDeviceChanges(body: string | undefined): DeviceChanges {
  const value = jsonObject(body);
  const changes: DeviceChanges = {};
  if (value.name !== undefined) changes.name = text(value.name, 'name', 1, 100);
  if (value.vehicleType !== undefined) changes.vehicleType = vehicleType(value.vehicleType);
  // null moves the vehicle out of its group.
  if (value.groupId !== undefined)
    changes.groupId = value.groupId === null ? UNGROUPED : text(value.groupId, 'groupId', 1, 64);
  if (value.model !== undefined)
    changes.model = clearable(value.model, (model) => text(model, 'model', 1, 100));
  if (value.fuelType !== undefined) changes.fuelType = clearable(value.fuelType, fuelType);
  if (value.purchasedOn !== undefined)
    changes.purchasedOn = clearable(value.purchasedOn, purchasedOn);
  if (value.colour !== undefined)
    changes.colour = clearable(value.colour, (colour) => text(colour, 'colour', 1, 40));
  if (value.driverId !== undefined)
    changes.driverId = clearable(value.driverId, (driverId) => text(driverId, 'driverId', 1, 64));
  if (value.speedLimitKmh !== undefined)
    changes.speedLimitKmh = clearable(value.speedLimitKmh, (limit) => {
      if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 5 || limit > 300)
        throw new InputError('speedLimitKmh must be from 5 to 300');
      return limit;
    });
  for (const [key, max] of [
    ['fuelDropThreshold', 100],
    ['fuelIncreaseThreshold', 100],
    ['accelerationThresholdMs2', 20],
    ['brakingThresholdMs2', 20],
  ] as const)
    if (value[key] !== undefined)
      changes[key] = clearable(value[key], (threshold) => {
        if (
          typeof threshold !== 'number' ||
          !Number.isFinite(threshold) ||
          threshold <= 0 ||
          threshold > max
        )
          throw new InputError(`${key} must be above 0 and at most ${max}`);
        return threshold;
      });
  if (value.proximity !== undefined) changes.proximity = clearable(value.proximity, proximity);
  if (value.trackerIntervalSeconds !== undefined) {
    if (!(trackerIntervals as readonly unknown[]).includes(value.trackerIntervalSeconds))
      throw new InputError('trackerIntervalSeconds is unsupported');
    changes.trackerIntervalSeconds = value.trackerIntervalSeconds as number;
  }
  if (value.pauseLimitMinutes !== undefined) {
    if (!(pauseLimits as readonly unknown[]).includes(value.pauseLimitMinutes))
      throw new InputError('pauseLimitMinutes is unsupported');
    changes.pauseLimitMinutes = value.pauseLimitMinutes as number;
  }
  if (!Object.keys(changes).length)
    throw new InputError('at least one field to change is required');
  return changes;
}

function proximity(value: unknown): DeviceProximity {
  if (!isRecord(value)) throw new InputError('proximity is invalid');
  const linked = value.linkedDeviceIds;
  if (
    !Array.isArray(linked) ||
    linked.length > 10 ||
    linked.some((id) => typeof id !== 'string' || !id || id.length > 64)
  )
    throw new InputError('proximity.linkedDeviceIds must list up to 10 vehicles');
  const distance = (key: string) => {
    const metres = value[key];
    if (metres === undefined) return undefined;
    if (typeof metres !== 'number' || !Number.isFinite(metres) || metres <= 0 || metres > 50_000)
      throw new InputError(`proximity.${key} must be above 0 and at most 50000 metres`);
    return metres;
  };
  return {
    linkedDeviceIds: [...new Set(linked as string[])],
    enterDistanceM: distance('enterDistanceM'),
    exitDistanceM: distance('exitDistanceM'),
    unaccompaniedDistanceM: distance('unaccompaniedDistanceM'),
  };
}

function parseAccumulators(body: string | undefined, now: number) {
  const value = jsonObject(body);
  const result: { odometerM?: number; engineHoursS?: number; setAt: number } = { setAt: now };
  for (const key of ['odometerM', 'engineHoursS'] as const) {
    const number = value[key];
    if (number === undefined) continue;
    if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > 1e10)
      throw new InputError(`${key} must be a non-negative number`);
    result[key] = number;
  }
  if (result.odometerM === undefined && result.engineHoursS === undefined)
    throw new InputError('odometerM or engineHoursS is required');
  return result;
}

function parseDevice(body: string | undefined): DeviceInput {
  const value = jsonObject(body);
  const name = text(value.name, 'name', 1, 100);
  const uniqueId = text(value.uniqueId, 'uniqueId', 5, 64);
  const protocol = text(value.protocol, 'protocol', 2, 32);
  // osmand is the phone app over HTTP; the rest are trackers on the TCP gateway.
  if (protocol !== 'osmand' && !isTrackerProtocol(protocol))
    throw new InputError('protocol is unsupported');
  const retentionDays = boundedNumber(value.retentionDays, 90, 1, 3_650);
  const groupId = value.groupId === undefined ? UNGROUPED : text(value.groupId, 'groupId', 1, 64);
  const type =
    value.vehicleType === undefined ? defaultVehicleType : vehicleType(value.vehicleType);
  return {
    name,
    uniqueId,
    protocol,
    retentionDays,
    groupId,
    vehicleType: type,
    model: optionalText(value.model, 'model', 1, 100),
    fuelType: value.fuelType === undefined ? undefined : fuelType(value.fuelType),
    purchasedOn: value.purchasedOn === undefined ? undefined : purchasedOn(value.purchasedOn),
    colour: optionalText(value.colour, 'colour', 1, 40),
  };
}

/** The plan limit applies to every interval a fleet admin sets, fleet-wide or per vehicle. */
function requireAllowedInterval(seconds: number, organisation: Organisation | undefined) {
  const fastest = fastestIntervalFor(organisation?.plan);
  if (seconds < fastest)
    throw new InputError(`your plan allows syncing every ${fastest} seconds at the fastest`);
}

/** The organisation with its plan spelled out, so the dashboard can offer only allowed intervals. */
function withPlan(organisation: Organisation) {
  const plan = isSubscriptionPlan(organisation.plan) ? organisation.plan : defaultSubscriptionPlan;
  return {
    ...organisation,
    plan,
    fastestTrackerIntervalSeconds: fastestIntervalFor(plan),
    effectiveTrackerIntervalSeconds: effectiveTrackerInterval({
      fleet: organisation.trackerIntervalSeconds,
      plan,
    }),
  };
}

function parseOrganisationChanges(body: string | undefined) {
  const value = jsonObject(body);
  const changes: {
    name?: string;
    dispatcherPhone?: string | null;
    timeZone?: string;
    trackerIntervalSeconds?: number | null;
  } = {};
  // null goes back to the platform default (30 s).
  if (value.trackerIntervalSeconds !== undefined)
    changes.trackerIntervalSeconds = clearable(value.trackerIntervalSeconds, (seconds) => {
      if (!(trackerIntervals as readonly unknown[]).includes(seconds))
        throw new InputError('trackerIntervalSeconds is unsupported');
      return seconds as number;
    });
  if (value.name !== undefined) changes.name = text(value.name, 'name', 1, 100).trim();
  if (value.name !== undefined && !changes.name) throw new InputError('name is invalid');
  if (value.dispatcherPhone !== undefined)
    changes.dispatcherPhone = clearable(value.dispatcherPhone, (phone) =>
      text(phone, 'dispatcherPhone', 3, 20),
    );
  if (value.timeZone !== undefined) {
    if (!isTimeZone(value.timeZone)) throw new InputError('timeZone must be an IANA time zone');
    changes.timeZone = value.timeZone;
  }
  if (!Object.keys(changes).length)
    throw new InputError('at least one field to change is required');
  return changes;
}

function parseDriverInput(body: string | undefined): DriverInput {
  const value = jsonObject(body);
  return {
    name: text(value.name, 'name', 1, 100),
    phone: optionalText(value.phone, 'phone', 3, 20),
    licenceNumber: optionalText(value.licenceNumber, 'licenceNumber', 1, 40),
    rfid: optionalText(value.rfid, 'rfid', 1, 64),
  };
}

function parseDriverChanges(body: string | undefined): DriverChanges {
  const value = jsonObject(body);
  const changes: DriverChanges = {};
  if (value.name !== undefined) changes.name = text(value.name, 'name', 1, 100);
  if (value.phone !== undefined)
    changes.phone = clearable(value.phone, (phone) => text(phone, 'phone', 3, 20));
  if (value.licenceNumber !== undefined)
    changes.licenceNumber = clearable(value.licenceNumber, (licence) =>
      text(licence, 'licenceNumber', 1, 40),
    );
  if (value.rfid !== undefined)
    changes.rfid = clearable(value.rfid, (rfid) => text(rfid, 'rfid', 1, 64));
  if (!Object.keys(changes).length)
    throw new InputError('at least one field to change is required');
  return changes;
}

/** Each card identifies one driver, or driver-change alerts could name the wrong person. */
async function rfidTaken(
  store: FleetStore,
  tenantId: string,
  rfid: string,
  exceptDriverId?: string,
) {
  const drivers = (await store.listDrivers(tenantId)) as Array<{ driverId: string; rfid?: string }>;
  return drivers.some((driver) => driver.rfid === rfid && driver.driverId !== exceptDriverId);
}

function isTransactionConflict(error: unknown) {
  return error instanceof Error && error.name === 'TransactionCanceledException';
}

function isCodeConflict(error: unknown) {
  return error instanceof Error && error.name === 'ConditionalCheckFailedException';
}

const client = createDocumentClient();
export const handler = createHandler(
  new DynamoFleetStore(
    client,
    requiredEnv('CORE_TABLE'),
    requiredEnv('DEVICE_STATE_TABLE'),
    requiredEnv('POSITIONS_TABLE'),
    {
      events: requiredEnv('EVENTS_TABLE'),
      trips: requiredEnv('TRIPS_TABLE'),
      dailyStats: requiredEnv('DAILY_STATS_TABLE'),
      commands: requiredEnv('COMMANDS_TABLE'),
    },
  ),
  new DynamoOnboardingStore(client, requiredEnv('ONBOARDING_TABLE')),
  requiredEnv('ONBOARDING_WEB_URL'),
  new DynamoActivityStore(client, requiredEnv('CORE_TABLE')),
  photoStoreFromEnv(requiredEnv('PHOTOS_BUCKET')),
  {
    admin: new DynamoAdminStore(client, requiredEnv('CORE_TABLE')),
    identity: identityDirectoryFromEnv(requiredEnv('USER_POOL_ID')),
    notifications: new DynamoNotificationStore(client, requiredEnv('CORE_TABLE')),
    reports: new DynamoReportStore(client, requiredEnv('CORE_TABLE')),
    geocoder: geocoderFromEnv(),
    shares: new DynamoShareStore(client, requiredEnv('CORE_TABLE')),
    audit: new DynamoAuditStore(client, requiredEnv('CORE_TABLE')),
    announcements: new DynamoAnnouncementStore(client, requiredEnv('CORE_TABLE')),
    announcementQueue: announcementQueueFromEnv(process.env.ANNOUNCEMENTS_TOPIC_ARN),
  },
);

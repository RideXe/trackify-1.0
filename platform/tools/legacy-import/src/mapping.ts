import type {
  ComputedAttributeInput,
  GeofenceShape,
  MaintenanceInput,
  RuleInput,
} from '@trackify/data';
import {
  alarmTypeSchema,
  eventTypeSchema,
  type NotificationChannel,
  type VehicleType,
} from '@trackify/domain';
import { compile, computedTargets } from '@trackify/fleet';
import { isTrackerProtocol } from '@trackify/protocols/ports';

/** The legacy server's REST shapes, as far as the import reads them. */
export interface LegacyDevice {
  id: number;
  name: string;
  uniqueId: string;
  groupId?: number;
  phone?: string;
  model?: string;
  category?: string;
  disabled?: boolean;
  attributes?: Record<string, unknown>;
}
export interface LegacyGroup {
  id: number;
  name: string;
}
export interface LegacyGeofence {
  id: number;
  name: string;
  description?: string;
  area: string;
}
export interface LegacyDriver {
  id: number;
  name: string;
  uniqueId?: string;
}
export interface LegacyNotification {
  id: number;
  type: string;
  always: boolean;
  notificators?: string;
  attributes?: Record<string, unknown>;
}
export interface LegacyMaintenance {
  id: number;
  name: string;
  type: string;
  start: number;
  period: number;
}
export interface LegacyComputed {
  id: number;
  description?: string;
  attribute: string;
  expression: string;
  type: string;
}
export interface LegacyUser {
  id: number;
  name: string;
  email: string;
  administrator?: boolean;
  readonly?: boolean;
  disabled?: boolean;
}
export interface LegacyPosition {
  deviceId: number;
  protocol?: string;
}

/** What the import would do, before anything is written. */
export interface ImportPlan {
  groups: Array<{ legacyId: number; name: string }>;
  devices: Array<{
    legacyId: number;
    name: string;
    uniqueId: string;
    protocol: string;
    legacyGroupId?: number;
    vehicleType: VehicleType;
    model?: string;
    speedLimitKmh?: number;
    fuelDropThreshold?: number;
    fuelIncreaseThreshold?: number;
  }>;
  geofences: Array<{ name: string; description?: string; shape: GeofenceShape }>;
  drivers: Array<{ name: string; rfid?: string }>;
  rules: Array<
    Omit<RuleInput, 'deviceIds' | 'groupIds'> & {
      legacyDeviceIds: number[];
      legacyGroupIds: number[];
    }
  >;
  maintenances: MaintenanceInput[];
  computed: ComputedAttributeInput[];
  users: Array<{ email: string; name: string; role: 'admin' | 'dispatcher' | 'viewer' }>;
  warnings: string[];
}

export interface LegacyData {
  groups: LegacyGroup[];
  devices: LegacyDevice[];
  latestPositions: LegacyPosition[];
  geofences: LegacyGeofence[];
  drivers: LegacyDriver[];
  notifications: LegacyNotification[];
  notificationLinks: Map<number, { deviceIds: number[]; groupIds: number[] }>;
  maintenances: LegacyMaintenance[];
  computed: LegacyComputed[];
  users: LegacyUser[];
}

const KNOTS_TO_KMH = 1.852;

const CATEGORIES: Record<string, VehicleType> = {
  car: 'car',
  bus: 'bus',
  truck: 'truck',
  pickup: 'truck',
  van: 'van',
  motorcycle: 'motorbike',
  scooter: 'scooter',
  tractor: 'tractor',
  person: 'asset',
  animal: 'asset',
};

const NOTIFICATORS: Record<string, NotificationChannel> = {
  web: 'web',
  mail: 'email',
  sms: 'sms',
  firebase: 'push',
  traccar: 'push',
  telegram: 'telegram',
  whatsapp: 'whatsapp',
  pushover: 'pushover',
  command: 'command',
};

/** Legacy attribute names for the attributes the platform knows. */
const COMPUTED_TARGETS: Record<string, string> = {
  ignition: 'ignition',
  motion: 'motion',
  charge: 'charging',
  power: 'powerV',
  battery: 'batteryV',
  batteryLevel: 'batteryLevelPct',
  odometer: 'odometerM',
  driverUniqueId: 'driverUniqueId',
};

export function planImport(legacy: LegacyData, defaultProtocol?: string): ImportPlan {
  const warnings: string[] = [];
  const protocolOf = new Map(
    legacy.latestPositions.map((position) => [position.deviceId, position.protocol]),
  );
  const plan: ImportPlan = {
    groups: legacy.groups.map((group) => ({ legacyId: group.id, name: group.name })),
    devices: [],
    geofences: [],
    drivers: legacy.drivers.map((driver) => ({
      name: driver.name,
      ...(driver.uniqueId ? { rfid: driver.uniqueId } : {}),
    })),
    rules: [],
    maintenances: [],
    computed: [],
    users: [],
    warnings,
  };

  for (const device of legacy.devices) {
    // The legacy server learns a device's protocol from the port it connects to, so the import
    // takes it from the device's latest position.
    const protocol = protocolOf.get(device.id) ?? defaultProtocol;
    if (!protocol || !isTrackerProtocol(protocol)) {
      warnings.push(
        `vehicle "${device.name}" (${device.uniqueId}) skipped: protocol ${protocol ? `"${protocol}" is not supported` : 'unknown; it has no position yet — pass --default-protocol'}`,
      );
      continue;
    }
    const attributes = device.attributes ?? {};
    const number = (key: string) =>
      typeof attributes[key] === 'number' ? attributes[key] : undefined;
    const speedLimit = number('speedLimit');
    plan.devices.push({
      legacyId: device.id,
      name: device.name,
      uniqueId: device.uniqueId,
      protocol,
      legacyGroupId: device.groupId || undefined,
      vehicleType:
        CATEGORIES[device.category ?? ''] ??
        (device.category && device.category !== 'default' ? 'other' : 'car'),
      ...(device.model ? { model: device.model } : {}),
      ...(speedLimit ? { speedLimitKmh: Math.round(speedLimit * KNOTS_TO_KMH) } : {}),
      ...(number('fuelDropThreshold') ? { fuelDropThreshold: number('fuelDropThreshold') } : {}),
      ...(number('fuelIncreaseThreshold')
        ? { fuelIncreaseThreshold: number('fuelIncreaseThreshold') }
        : {}),
    });
  }

  for (const geofence of legacy.geofences) {
    const shape = parseArea(geofence.area);
    if (typeof shape === 'string') warnings.push(`geofence "${geofence.name}" skipped: ${shape}`);
    else
      plan.geofences.push({
        name: geofence.name,
        ...(geofence.description ? { description: geofence.description } : {}),
        shape,
      });
  }

  for (const notification of legacy.notifications) {
    const type = eventTypeSchema.safeParse(notification.type);
    if (!type.success) {
      warnings.push(
        `notification ${notification.id} skipped: event type "${notification.type}" is not supported`,
      );
      continue;
    }
    const names = (notification.notificators ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    const channels = [
      ...new Set(
        names
          .map((name) => NOTIFICATORS[name])
          .filter((channel): channel is NotificationChannel => Boolean(channel)),
      ),
    ];
    for (const name of names)
      if (!NOTIFICATORS[name])
        warnings.push(
          `notification ${notification.id}: channel "${name}" is not supported and was dropped`,
        );
    if (channels.includes('command')) {
      // Saved commands do not carry over; the rule keeps its other channels.
      warnings.push(
        `notification ${notification.id}: its command was not imported; set one on the alert rule`,
      );
      channels.splice(channels.indexOf('command'), 1);
    }
    if (!channels.length) {
      warnings.push(`notification ${notification.id} skipped: no supported channels`);
      continue;
    }
    const alarms = (
      typeof notification.attributes?.alarms === 'string' ? notification.attributes.alarms : ''
    )
      .split(',')
      .map((alarm) => alarm.trim())
      .filter((alarm) => alarmTypeSchema.safeParse(alarm).success) as RuleInput['alarms'];
    const links = notification.always
      ? { deviceIds: [], groupIds: [] }
      : (legacy.notificationLinks.get(notification.id) ?? { deviceIds: [], groupIds: [] });
    if (!notification.always && !links.deviceIds.length && !links.groupIds.length) {
      warnings.push(`notification ${notification.id} skipped: it is linked to no vehicle or group`);
      continue;
    }
    plan.rules.push({
      name: `${notification.type}${alarms.length ? ` (${alarms.join(', ')})` : ''}`,
      enabled: true,
      eventTypes: [type.data],
      alarms,
      channels,
      userIds: [],
      legacyDeviceIds: links.deviceIds,
      legacyGroupIds: links.groupIds,
    });
  }

  for (const maintenance of legacy.maintenances) {
    const mapped = mapMaintenance(maintenance);
    if (mapped) plan.maintenances.push(mapped);
    else
      warnings.push(
        `maintenance "${maintenance.name}" skipped: type "${maintenance.type}" is not supported`,
      );
  }

  legacy.computed.forEach((attribute, order) => {
    const target =
      COMPUTED_TARGETS[attribute.attribute] ?? attribute.attribute.replace(/[^A-Za-z0-9]/g, '');
    const type =
      attribute.type === 'boolean' || attribute.type === 'string' ? attribute.type : 'number';
    const known = computedTargets[target as keyof typeof computedTargets];
    try {
      compile(attribute.expression);
    } catch (error) {
      warnings.push(
        `computed attribute "${attribute.description ?? attribute.attribute}" skipped: expression not supported (${(error as Error).message})`,
      );
      return;
    }
    if (!target || (known && known !== type)) {
      warnings.push(
        `computed attribute "${attribute.description ?? attribute.attribute}" skipped: ${attribute.attribute} cannot be a ${type}`,
      );
      return;
    }
    plan.computed.push({
      attribute: target,
      expression: attribute.expression,
      type,
      order,
      deviceIds: [],
      groupIds: [],
      ...(attribute.description ? { description: attribute.description.slice(0, 200) } : {}),
    });
  });

  for (const user of legacy.users) {
    if (user.disabled || !user.email) continue;
    plan.users.push({
      email: user.email.toLowerCase(),
      name: user.name,
      role: user.administrator ? 'admin' : user.readonly ? 'viewer' : 'dispatcher',
    });
  }
  return plan;
}

/**
 * The legacy server's WKT, latitude first: `CIRCLE (lat lon, radius)` or
 * `POLYGON ((lat lon, lat lon, ...))`. Returns the reason as a string when it cannot be used.
 */
export function parseArea(area: string): GeofenceShape | string {
  const circle = /^\s*CIRCLE\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*,\s*([\d.]+)\s*\)\s*$/i.exec(area);
  if (circle) {
    const radiusM = Number(circle[3]);
    if (radiusM < 10 || radiusM > 100_000)
      return `circle radius ${radiusM} m is outside 10–100000 m`;
    return {
      type: 'circle',
      center: { latitude: Number(circle[1]), longitude: Number(circle[2]) },
      radiusM,
    };
  }
  const polygon = /^\s*POLYGON\s*\(\(\s*(.+?)\s*\)\)\s*$/i.exec(area);
  if (polygon) {
    const points = polygon[1]!.split(',').map((pair) => {
      const [latitude, longitude] = pair.trim().split(/\s+/).map(Number);
      return { latitude: latitude!, longitude: longitude! };
    });
    // WKT repeats the first point at the end.
    const last = points.at(-1);
    if (
      points.length > 1 &&
      last &&
      last.latitude === points[0]!.latitude &&
      last.longitude === points[0]!.longitude
    )
      points.pop();
    if (
      points.some((point) => !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude))
    )
      return 'polygon has invalid points';
    if (points.length < 3 || points.length > 100)
      return `polygon has ${points.length} points; 3 to 100 are supported`;
    return { type: 'polygon', points };
  }
  return 'only circles and polygons are supported (lines are not)';
}

function mapMaintenance(maintenance: LegacyMaintenance): MaintenanceInput | undefined {
  const base = { name: maintenance.name, deviceIds: [], groupIds: [] };
  switch (maintenance.type) {
    case 'totalDistance':
    case 'odometer':
      return { ...base, type: 'odometerM', start: maintenance.start, period: maintenance.period };
    case 'hours':
      // The legacy server counts engine hours in milliseconds.
      return {
        ...base,
        type: 'engineHoursS',
        start: maintenance.start / 1000,
        period: maintenance.period / 1000,
      };
    case 'fixTime':
    case 'deviceTime':
    case 'serverTime':
      return { ...base, type: 'fixTime', start: maintenance.start, period: maintenance.period };
    default:
      return undefined;
  }
}

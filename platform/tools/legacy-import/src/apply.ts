import type { DynamoAdminStore, DynamoFleetStore, DynamoNotificationStore } from '@trackify/data';
import type { ImportPlan } from './mapping';

export interface ImportStores {
  admin: Pick<
    DynamoAdminStore,
    | 'listGroups'
    | 'createGroup'
    | 'listGeofences'
    | 'createGeofence'
    | 'listMaintenances'
    | 'createMaintenance'
    | 'listComputed'
    | 'createComputed'
  >;
  fleet: Pick<
    DynamoFleetStore,
    'listDevices' | 'createDevice' | 'updateDevice' | 'listDrivers' | 'createDriver'
  >;
  notifications: Pick<DynamoNotificationStore, 'listRules' | 'createRule'>;
}

export interface ImportResult {
  created: Record<string, number>;
  skipped: string[];
}

/**
 * Writes the plan into one tenant. Re-running is safe: anything already there (same vehicle id,
 * or same name for the rest) is left alone and reported.
 */
export async function applyPlan(
  plan: ImportPlan,
  tenantId: string,
  stores: ImportStores,
): Promise<ImportResult> {
  const created: Record<string, number> = {};
  const skipped: string[] = [];
  const count = (kind: string) => (created[kind] = (created[kind] ?? 0) + 1);

  const groupIds = new Map<number, string>();
  const existingGroups = new Map(
    (await stores.admin.listGroups(tenantId)).map((group) => [group.name, group.groupId]),
  );
  for (const group of plan.groups) {
    const existing = existingGroups.get(group.name);
    if (existing) {
      groupIds.set(group.legacyId, existing);
      skipped.push(`group "${group.name}" already exists`);
      continue;
    }
    const createdGroup = await stores.admin.createGroup(tenantId, { name: group.name });
    groupIds.set(group.legacyId, createdGroup.groupId);
    count('groups');
  }

  const deviceIds = new Map<number, string>();
  const existingDevices = new Map(
    (await stores.fleet.listDevices(tenantId)).map((device) => [device.uniqueId, device.deviceId]),
  );
  for (const device of plan.devices) {
    const existing = existingDevices.get(device.uniqueId);
    if (existing) {
      deviceIds.set(device.legacyId, existing);
      skipped.push(`vehicle "${device.name}" (${device.uniqueId}) already exists`);
      continue;
    }
    const createdDevice = await stores.fleet.createDevice(tenantId, {
      name: device.name,
      uniqueId: device.uniqueId,
      protocol: device.protocol,
      retentionDays: 90,
      groupId: (device.legacyGroupId && groupIds.get(device.legacyGroupId)) || 'UNGROUPED',
      vehicleType: device.vehicleType,
      ...(device.model ? { model: device.model } : {}),
    });
    deviceIds.set(device.legacyId, createdDevice.deviceId);
    const extras = {
      ...(device.speedLimitKmh ? { speedLimitKmh: device.speedLimitKmh } : {}),
      ...(device.fuelDropThreshold ? { fuelDropThreshold: device.fuelDropThreshold } : {}),
      ...(device.fuelIncreaseThreshold
        ? { fuelIncreaseThreshold: device.fuelIncreaseThreshold }
        : {}),
    };
    if (Object.keys(extras).length)
      await stores.fleet.updateDevice(tenantId, createdDevice.deviceId, extras);
    count('vehicles');
  }

  const byName = async <T extends { name?: string }>(items: Promise<T[]>) =>
    new Set((await items).map((item) => item.name));
  const geofenceNames = await byName(stores.admin.listGeofences(tenantId));
  for (const geofence of plan.geofences) {
    if (geofenceNames.has(geofence.name))
      skipped.push(`geofence "${geofence.name}" already exists`);
    else {
      await stores.admin.createGeofence(tenantId, geofence);
      count('geofences');
    }
  }
  const driverNames = await byName(stores.fleet.listDrivers(tenantId));
  for (const driver of plan.drivers) {
    if (driverNames.has(driver.name)) skipped.push(`driver "${driver.name}" already exists`);
    else {
      await stores.fleet.createDriver(tenantId, driver);
      count('drivers');
    }
  }
  const ruleNames = await byName(stores.notifications.listRules(tenantId));
  for (const rule of plan.rules) {
    if (ruleNames.has(rule.name)) {
      skipped.push(`alert rule "${rule.name}" already exists`);
      continue;
    }
    const { legacyDeviceIds, legacyGroupIds, ...input } = rule;
    await stores.notifications.createRule(tenantId, {
      ...input,
      deviceIds: legacyDeviceIds.flatMap((id) => deviceIds.get(id) ?? []),
      groupIds: legacyGroupIds.flatMap((id) => groupIds.get(id) ?? []),
    });
    count('alert rules');
  }
  const maintenanceNames = await byName(stores.admin.listMaintenances(tenantId));
  for (const maintenance of plan.maintenances) {
    if (maintenanceNames.has(maintenance.name))
      skipped.push(`maintenance "${maintenance.name}" already exists`);
    else {
      await stores.admin.createMaintenance(tenantId, maintenance);
      count('maintenances');
    }
  }
  const computedTargets = new Set(
    (await stores.admin.listComputed(tenantId)).map(
      (item) => `${item.attribute}=${item.expression}`,
    ),
  );
  for (const attribute of plan.computed) {
    if (computedTargets.has(`${attribute.attribute}=${attribute.expression}`))
      skipped.push(`computed attribute ${attribute.attribute} already exists`);
    else {
      await stores.admin.createComputed(tenantId, attribute);
      count('computed attributes');
    }
  }
  return { created, skipped };
}

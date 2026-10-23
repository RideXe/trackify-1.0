import { describe, expect, it, vi } from 'vitest';
import { applyPlan, type ImportStores } from '../src/apply';
import { parseArea, planImport, type LegacyData } from '../src/mapping';

function legacy(overrides: Partial<LegacyData> = {}): LegacyData {
  return {
    groups: [{ id: 1, name: 'North depot' }],
    devices: [
      {
        id: 10,
        name: 'Van 1',
        uniqueId: '356314041419858',
        groupId: 1,
        category: 'van',
        attributes: { speedLimit: 43.2, fuelDropThreshold: 10 },
      },
      { id: 11, name: 'Bus 2', uniqueId: '359632101234567', category: 'bus' },
      { id: 12, name: 'New tracker', uniqueId: '123456789012345' },
    ],
    latestPositions: [
      { deviceId: 10, protocol: 'gt06' },
      { deviceId: 11, protocol: 'osmand' },
    ],
    geofences: [
      { id: 1, name: 'Depot', area: 'CIRCLE (12.9716 77.5946, 250)' },
      { id: 2, name: 'Yard', area: 'POLYGON ((12.9 77.5, 12.9 77.6, 13.0 77.6, 12.9 77.5))' },
      { id: 3, name: 'Route', area: 'LINESTRING (12.9 77.5, 13 77.6)' },
    ],
    drivers: [{ id: 1, name: 'Asha', uniqueId: 'CARD-1' }],
    notifications: [
      {
        id: 1,
        type: 'alarm',
        always: true,
        notificators: 'web,mail,firebase',
        attributes: { alarms: 'sos,powerCut' },
      },
      { id: 2, type: 'geofenceEnter', always: false, notificators: 'web' },
      { id: 3, type: 'textMessage', always: true, notificators: 'web' },
      { id: 4, type: 'ignitionOn', always: false, notificators: 'web' },
    ],
    notificationLinks: new Map([[2, { deviceIds: [10], groupIds: [1] }]]),
    maintenances: [
      { id: 1, name: 'Oil', type: 'totalDistance', start: 0, period: 10_000_000 },
      { id: 2, name: 'Service', type: 'hours', start: 0, period: 360_000_000 },
      { id: 3, name: 'Tyres', type: 'rpm', start: 0, period: 1 },
    ],
    computed: [
      {
        id: 1,
        attribute: 'power',
        expression: 'io66 * 0.001',
        type: 'number',
        description: 'Volts',
      },
      { id: 2, attribute: 'fuelLevel', expression: 'Math.round(io9)', type: 'number' },
    ],
    users: [
      { id: 1, name: 'Admin', email: 'Admin@Example.com', administrator: true },
      { id: 2, name: 'Viewer', email: 'viewer@example.com', readonly: true },
      { id: 3, name: 'Gone', email: 'gone@example.com', disabled: true },
    ],
    ...overrides,
  };
}

describe('import plan', () => {
  it('maps vehicles with protocol from their latest position, categories and units', () => {
    const plan = planImport(legacy());
    expect(plan.devices).toEqual([
      expect.objectContaining({
        uniqueId: '356314041419858',
        protocol: 'gt06',
        vehicleType: 'van',
        legacyGroupId: 1,
        speedLimitKmh: 80,
        fuelDropThreshold: 10,
      }),
    ]);
    expect(plan.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          '"Bus 2" (359632101234567) skipped: protocol "osmand" is not supported',
        ),
        expect.stringContaining('"New tracker" (123456789012345) skipped: protocol unknown'),
      ]),
    );
    expect(planImport(legacy(), 'h02').devices.map((device) => device.protocol)).toEqual([
      'gt06',
      'h02',
    ]);
  });

  it('converts geofence WKT, latitude first, and reports lines', () => {
    expect(parseArea('CIRCLE (12.9716 77.5946, 250)')).toEqual({
      type: 'circle',
      center: { latitude: 12.9716, longitude: 77.5946 },
      radiusM: 250,
    });
    expect(parseArea('POLYGON ((12.9 77.5, 12.9 77.6, 13.0 77.6, 12.9 77.5))')).toEqual({
      type: 'polygon',
      points: [
        { latitude: 12.9, longitude: 77.5 },
        { latitude: 12.9, longitude: 77.6 },
        { latitude: 13, longitude: 77.6 },
      ],
    });
    expect(planImport(legacy()).warnings).toContain(
      'geofence "Route" skipped: only circles and polygons are supported (lines are not)',
    );
  });

  it('turns notifications into alert rules with channels, alarms and links', () => {
    const plan = planImport(legacy());
    expect(plan.rules).toEqual([
      expect.objectContaining({
        eventTypes: ['alarm'],
        alarms: ['sos', 'powerCut'],
        channels: ['web', 'email', 'push'],
        legacyDeviceIds: [],
        legacyGroupIds: [],
      }),
      expect.objectContaining({
        eventTypes: ['geofenceEnter'],
        legacyDeviceIds: [10],
        legacyGroupIds: [1],
      }),
    ]);
    expect(plan.warnings).toEqual(
      expect.arrayContaining([
        'notification 3 skipped: event type "textMessage" is not supported',
        'notification 4 skipped: it is linked to no vehicle or group',
      ]),
    );
  });

  it('converts maintenance units and keeps only expressions the platform can run', () => {
    const plan = planImport(legacy());
    expect(plan.maintenances).toEqual([
      expect.objectContaining({ name: 'Oil', type: 'odometerM', period: 10_000_000 }),
      expect.objectContaining({ name: 'Service', type: 'engineHoursS', period: 360_000 }),
    ]);
    expect(plan.computed).toEqual([
      expect.objectContaining({ attribute: 'powerV', expression: 'io66 * 0.001' }),
    ]);
    expect(plan.warnings.some((warning) => warning.includes('Math.round'))).toBe(false);
    expect(
      plan.warnings.some((warning) => warning.startsWith('computed attribute "fuelLevel" skipped')),
    ).toBe(true);
  });

  it('lists active users to invite with mapped roles', () => {
    expect(planImport(legacy()).users).toEqual([
      { email: 'admin@example.com', name: 'Admin', role: 'admin' },
      { email: 'viewer@example.com', name: 'Viewer', role: 'viewer' },
    ]);
  });
});

describe('applying the plan', () => {
  function stores(): ImportStores & { calls: Record<string, ReturnType<typeof vi.fn>> } {
    const calls = {
      createGroup: vi.fn().mockResolvedValue({ groupId: 'g-new' }),
      createDevice: vi.fn().mockResolvedValue({ deviceId: 'd-new' }),
      updateDevice: vi.fn().mockResolvedValue({}),
      createRule: vi.fn().mockResolvedValue({}),
      createGeofence: vi.fn().mockResolvedValue({}),
    };
    return {
      calls,
      admin: {
        listGroups: vi.fn().mockResolvedValue([]),
        createGroup: calls.createGroup,
        listGeofences: vi.fn().mockResolvedValue([{ name: 'Depot' }]),
        createGeofence: calls.createGeofence,
        listMaintenances: vi.fn().mockResolvedValue([]),
        createMaintenance: vi.fn().mockResolvedValue({}),
        listComputed: vi.fn().mockResolvedValue([]),
        createComputed: vi.fn().mockResolvedValue({}),
      },
      fleet: {
        listDevices: vi.fn().mockResolvedValue([]),
        createDevice: calls.createDevice,
        updateDevice: calls.updateDevice,
        listDrivers: vi.fn().mockResolvedValue([]),
        createDriver: vi.fn().mockResolvedValue({}),
      },
      notifications: {
        listRules: vi.fn().mockResolvedValue([]),
        createRule: calls.createRule,
      },
    };
  }

  it('creates records with new ids wired through and skips what already exists', async () => {
    const target = stores();
    const result = await applyPlan(planImport(legacy()), 't', target);
    expect(target.calls.createDevice).toHaveBeenCalledWith(
      't',
      expect.objectContaining({ uniqueId: '356314041419858', groupId: 'g-new', protocol: 'gt06' }),
    );
    expect(target.calls.updateDevice).toHaveBeenCalledWith('t', 'd-new', {
      speedLimitKmh: 80,
      fuelDropThreshold: 10,
    });
    expect(target.calls.createRule).toHaveBeenLastCalledWith(
      't',
      expect.objectContaining({ deviceIds: ['d-new'], groupIds: ['g-new'] }),
    );
    expect(target.calls.createGeofence).toHaveBeenCalledTimes(1);
    expect(result.skipped).toContain('geofence "Depot" already exists');
    expect(result.created).toMatchObject({
      groups: 1,
      vehicles: 1,
      geofences: 1,
      'alert rules': 2,
    });
  });
});

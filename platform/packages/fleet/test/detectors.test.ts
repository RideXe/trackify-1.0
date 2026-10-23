import { describe, expect, it } from 'vitest';
import type { PositionMessage } from '@trackify/domain';
import { evaluatePosition, type FleetRules, type FleetState } from '../src/index';

const base = {
  v: 1,
  ingestId: 'i',
  messageId: '0123456789abcdef',
  tenantId: '01J9ZQ3V5X8K2M4N6P7R8S9T0V',
  deviceId: '01J9ZQ3W1A2B3C4D5E6F7G8H9J',
  uniqueId: '12345',
  protocol: 'gt06',
  source: 'gateway',
  retentionDays: 90,
  receivedAt: 1_000,
  fixTime: 1_000,
  valid: true,
  latitude: 12.9716,
  longitude: 77.5946,
  speedKmh: 0,
  attributes: { motion: false, ignition: true },
} satisfies PositionMessage;

const at = (
  second: number,
  extra: Partial<PositionMessage> = {},
  attributes: PositionMessage['attributes'] = {},
): PositionMessage => ({
  ...base,
  ...extra,
  messageId: `m-${String(second).padStart(14, '0')}`,
  fixTime: 1_000 + second * 1_000,
  attributes: { ...base.attributes, ...attributes },
});

function run(steps: PositionMessage[], rules: FleetRules = { geofences: [] }) {
  let state: FleetState | undefined;
  const events: Array<{
    type: string;
    alarm?: string;
    attributes: Record<string, unknown>;
    eventId: string;
  }> = [];
  for (const step of steps) {
    const result = evaluatePosition(state, step, rules);
    state = result.state;
    events.push(...result.events);
  }
  return {
    state: state!,
    events: events.filter(
      (event) =>
        ![
          'deviceOnline',
          'deviceMoving',
          'deviceStopped',
          'tripStarted',
          'tripEnded',
          'ignitionOn',
          'ignitionOff',
        ].includes(event.type),
    ),
  };
}

describe('fuel', () => {
  const rules: FleetRules = { geofences: [], fuel: { dropThreshold: 10, increaseThreshold: 20 } };

  it('reports drops and refills beyond the thresholds only', () => {
    const { events } = run(
      [
        at(0, {}, { fuelLevelPct: 80 }),
        at(60, {}, { fuelLevelPct: 75 }),
        at(120, {}, { fuelLevelPct: 60 }),
        at(180, {}, { fuelLevelPct: 95 }),
      ],
      rules,
    );
    expect(
      events.map((event) => [event.type, event.attributes.before, event.attributes.after]),
    ).toEqual([
      ['deviceFuelDrop', 75, 60],
      ['deviceFuelIncrease', 60, 95],
    ]);
  });

  it('stays quiet without thresholds', () => {
    expect(run([at(0, {}, { fuelLevelPct: 80 }), at(60, {}, { fuelLevelPct: 10 })]).events).toEqual(
      [],
    );
  });
});

describe('harsh driving', () => {
  const rules: FleetRules = {
    geofences: [],
    behaviour: { accelerationThresholdMs2: 3, brakingThresholdMs2: 4 },
  };
  const moving = (second: number, speedKmh: number, metres: number) =>
    at(second, { speedKmh, latitude: base.latitude + metres / 111_195 }, { motion: true });

  it('flags hard acceleration and braking from the speed change between fixes', () => {
    const { events } = run(
      [moving(0, 20, 0), moving(2, 50, 30), moving(4, 52, 60), moving(6, 20, 90)],
      rules,
    );
    expect(events.map((event) => event.alarm)).toEqual(['hardAcceleration', 'hardBraking']);
  });
});

describe('proximity and unaccompanied motion', () => {
  const trailer = { deviceId: 'trailer', latitude: base.latitude, longitude: base.longitude };
  const metresNorth = (metres: number) => base.latitude + metres / 111_195;

  it('reports coming close to and moving away from a linked vehicle', () => {
    const rules: FleetRules = {
      geofences: [],
      proximity: { enterDistanceM: 100, exitDistanceM: 200, linked: [trailer] },
    };
    const { events } = run(
      [
        at(0, { latitude: metresNorth(500) }),
        at(60, { latitude: metresNorth(50) }),
        at(120, { latitude: metresNorth(150) }),
        at(180, { latitude: metresNorth(400) }),
      ],
      rules,
    );
    expect(events.map((event) => [event.type, event.attributes.linkedDeviceId])).toEqual([
      ['proximityEnter', 'trailer'],
      ['proximityExit', 'trailer'],
    ]);
  });

  it('reports starting to move with no linked vehicle nearby', () => {
    const rules: FleetRules = {
      geofences: [],
      proximity: {
        unaccompaniedDistanceM: 50,
        linked: [{ ...trailer, latitude: metresNorth(1_000) }],
      },
    };
    const { events } = run(
      [at(0), at(60, { speedKmh: 20, latitude: metresNorth(100) }, { motion: true })],
      rules,
    );
    expect(events.map((event) => event.type)).toEqual(['unaccompaniedMotion']);
    const escorted: FleetRules = {
      geofences: [],
      proximity: { unaccompaniedDistanceM: 500, linked: [trailer] },
    };
    expect(
      run([at(0), at(60, { speedKmh: 20, latitude: metresNorth(100) }, { motion: true })], escorted)
        .events,
    ).toEqual([]);
  });
});

describe('maintenance', () => {
  it('fires each time an engine-hours interval is crossed', () => {
    const rules: FleetRules = {
      geofences: [],
      maintenances: [
        {
          maintenanceId: 'oil',
          name: 'Oil change',
          type: 'engineHoursS',
          start: 3_600,
          period: 3_600,
        },
      ],
    };
    const steps = [0, 1_800, 3_000, 3_700, 7_100, 7_300].map((engine, index) =>
      at(index * 60, {}, { engineHoursS: engine }),
    );
    const { events } = run(steps, rules);
    expect(
      events.map((event) => [
        event.type,
        event.attributes.maintenanceName,
        event.attributes.engineHoursS,
      ]),
    ).toEqual([
      ['maintenance', 'Oil change', 3_700],
      ['maintenance', 'Oil change', 7_300],
    ]);
  });
});

describe('engine hours and drivers', () => {
  it('counts engine time while the ignition is on, ignoring long signal gaps', () => {
    const { state } = run([
      at(0),
      at(60),
      at(120, {}, { ignition: false }),
      at(180),
      at(3_000, {}, { ignition: true }),
      at(3_060),
    ]);
    expect(state.engineHoursS).toBe(120 + 60);
  });

  it('reports a new driver card once', () => {
    const { events } = run([
      at(0, {}, { driverUniqueId: 'A1' }),
      at(60, {}, { driverUniqueId: 'A1' }),
      at(120, {}, { driverUniqueId: 'B2' }),
    ]);
    expect(events.map((event) => [event.type, event.attributes.driverUniqueId])).toEqual([
      ['driverChanged', 'B2'],
    ]);
  });

  it('keeps two alarms from one fix as separate events', () => {
    const { events } = run([at(0), at(60, {}, { alarms: ['sos', 'powerCut'] })]);
    expect(new Set(events.map((event) => event.eventId)).size).toBe(2);
  });
});

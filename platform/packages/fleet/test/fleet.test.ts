import { describe, expect, it } from 'vitest';
import type { PositionMessage } from '@trackify/domain';
import { evaluatePosition, isPlausibleLiveFix } from '../src/index';

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
  speedKmh: 30,
  attributes: { motion: true, ignition: true },
} satisfies PositionMessage;

describe('fleet transition', () => {
  it('keeps invalid and impossible GPS fixes out of live state', () => {
    expect(isPlausibleLiveFix(undefined, { ...base, valid: false })).toBe(false);
    expect(isPlausibleLiveFix(undefined, { ...base, latitude: 0, longitude: 0 })).toBe(false);
    expect(
      isPlausibleLiveFix(
        { fixTime: 1_000, latitude: base.latitude, longitude: base.longitude },
        { ...base, fixTime: 2_000, latitude: 13.0827, longitude: 80.2707 },
      ),
    ).toBe(false);
  });

  it('starts and completes a trip without duplicating deterministic events', () => {
    const started = evaluatePosition(undefined, base, { geofences: [] });
    expect(started.events.map((event) => event.type)).toEqual(['deviceOnline', 'tripStarted']);
    const stopped = evaluatePosition(
      started.state,
      {
        ...base,
        messageId: 'fedcba9876543210',
        fixTime: 61_000,
        receivedAt: 61_000,
        latitude: 12.9726,
        speedKmh: 0,
        attributes: { motion: false, ignition: true },
      },
      { geofences: [] },
    );
    // Stopping alone does not end the trip: it might be a red light.
    expect(stopped.events.map((event) => event.type)).toEqual(['deviceStopped']);
    expect(stopped.completedTrip).toBeUndefined();
    const parked = evaluatePosition(
      stopped.state,
      {
        ...base,
        messageId: 'parked-000000001',
        fixTime: 61_000 + 5 * 60_000,
        receivedAt: 61_000 + 5 * 60_000,
        latitude: 12.9726,
        speedKmh: 0,
        attributes: { motion: false, ignition: true },
      },
      { geofences: [] },
    );
    expect(parked.events.map((event) => event.type)).toEqual(['tripEnded']);
    // It ended when the vehicle stopped, not five minutes later.
    expect(parked.events[0]?.eventTime).toBe(61_000);
    expect(parked.completedTrip).toMatchObject({ startTime: 1_000, endTime: 61_000 });
    expect(parked.completedTrip?.distanceM).toBeGreaterThan(100);
  });

  it('emits geofence, overspeed, alarm and ignition transitions', () => {
    const result = evaluatePosition(
      undefined,
      {
        ...base,
        speedKmh: 90,
        attributes: { motion: true, ignition: true, alarms: ['sos'] },
      },
      {
        speedLimitKmh: 80,
        geofences: [
          {
            id: '01J9ZQ3X9K8J7H6G5F4E3D2C1B',
            shape: { type: 'circle', center: base, radiusM: 100 },
          },
        ],
      },
    );
    expect(result.events.map((event) => event.type)).toEqual([
      'deviceOnline',
      'deviceOverspeed',
      'geofenceEnter',
      'alarm',
      'tripStarted',
    ]);
  });

  it('records a speeding episode: speed and driver as it starts, top speed and length as it ends', () => {
    const rules = { speedLimitKmh: 60, driverId: 'driver-1', geofences: [] };
    const at = (second: number, speedKmh: number, north: number) => ({
      ...base,
      messageId: `m-${second}`.padEnd(16, '0'),
      fixTime: 1_000 + second * 1000,
      receivedAt: 1_000 + second * 1000,
      latitude: base.latitude + north / 111_195,
      speedKmh,
    });
    const cruising = evaluatePosition(undefined, at(0, 50, 0), rules);
    const over = evaluatePosition(cruising.state, at(10, 72, 150), rules);
    expect(over.events.find((event) => event.type === 'deviceOverspeed')?.attributes).toEqual({
      speedKmh: 72,
      speedLimitKmh: 60,
      driverId: 'driver-1',
    });
    const faster = evaluatePosition(over.state, at(20, 91, 400), rules);
    expect(faster.events.map((event) => event.type)).not.toContain('deviceOverspeed');
    expect(faster.state.overspeed?.maxSpeedKmh).toBe(91);
    const back = evaluatePosition(faster.state, at(70, 55, 900), rules);
    expect(back.events.find((event) => event.type === 'overspeedEnded')?.attributes).toMatchObject({
      maxSpeedKmh: 91,
      speedLimitKmh: 60,
      durationS: 60,
      driverId: 'driver-1',
    });
    expect(back.state.overspeed).toBeUndefined();
  });

  it('reports leaving a geofence but not the deletion of one the vehicle was inside', () => {
    const depot = {
      id: '01J9ZQ3X9K8J7H6G5F4E3D2C1B',
      shape: { type: 'circle' as const, center: base, radiusM: 100 },
    };
    const yard = {
      id: '01J9ZQ3X9K8J7H6G5F4E3D2C1C',
      shape: { type: 'circle' as const, center: base, radiusM: 200 },
    };
    const inside = evaluatePosition(undefined, base, { geofences: [depot, yard] }).state;
    const next = { ...base, messageId: 'fedcba9876543210', fixTime: 2_000, latitude: 12.9734 };
    const result = evaluatePosition(inside, next, { geofences: [depot] });
    expect(
      result.events
        .filter((event) => event.type === 'geofenceExit')
        .map((event) => event.geofenceId),
    ).toEqual([depot.id]);
    expect(result.state.geofencesInside).toEqual([]);
  });
});

describe('GPS drift while parked', () => {
  // A phone indoors: Wi-Fi/cell fixes with ~80 m accuracy and noisy speed, no motion sensor.
  const phone = {
    ...base,
    protocol: 'osmand',
    source: 'http',
    latitude: 12.9335805,
    longitude: 77.5362201,
    accuracyM: 82,
    speedKmh: undefined,
    attributes: {},
  } satisfies PositionMessage;
  const metresNorth = (metres: number) => phone.latitude + metres / 111_195;
  const reading = (second: number, extra: Partial<PositionMessage>): PositionMessage => ({
    ...phone,
    messageId: `drift-${String(second).padStart(12, '0')}`,
    fixTime: 1_000 + second * 1_000,
    receivedAt: 1_000 + second * 1_000,
    ...extra,
  });

  it('keeps a parked phone in place: no distance, trips, movement events or speed', () => {
    let state = evaluatePosition(undefined, phone, { geofences: [] }).state;
    const types: string[] = [];
    const wander = [60, -40, 90, 10, -70, 120, -20];
    wander.forEach((metres, index) => {
      const next = evaluatePosition(
        state,
        reading((index + 1) * 30, {
          latitude: metresNorth(metres),
          accuracyM: 75 + index,
          speedKmh: 11,
        }),
        { geofences: [] },
      );
      types.push(...next.events.map((event) => event.type));
      state = next.state;
    });
    expect(types).toEqual([]);
    expect(state.odometerM).toBe(0);
    expect(state.trip).toBeUndefined();
    expect(state.speedKmh).toBe(0);
    expect(state.latitude).toBe(phone.latitude);
    expect(state.fixTime).toBe(1_000 + 7 * 30 * 1_000);
  });

  it('counts a real drive once the vehicle leaves the drift zone', () => {
    const parked = evaluatePosition(undefined, phone, { geofences: [] }).state;
    const driving = evaluatePosition(
      parked,
      reading(30, { latitude: metresNorth(300), accuracyM: 8, speedKmh: 36 }),
      { geofences: [] },
    );
    expect(driving.events.map((event) => event.type)).toEqual(['deviceMoving', 'tripStarted']);
    expect(driving.state.odometerM).toBeGreaterThan(290);
    expect(driving.state.speedKmh).toBe(36);
  });

  it('lets a more accurate reading refine the parked position without adding distance', () => {
    const parked = evaluatePosition(undefined, phone, { geofences: [] }).state;
    const refined = evaluatePosition(
      parked,
      reading(30, { latitude: metresNorth(50), accuracyM: 6 }),
      { geofences: [] },
    ).state;
    expect(refined.latitude).toBe(metresNorth(50));
    expect(refined.accuracyM).toBe(6);
    expect(refined.odometerM).toBe(0);
  });

  describe('trips, as a driver would count them', () => {
    const at = (second: number) => 1_000 + second * 1_000;
    const fix = (second: number, north: number, moving: boolean, path = 0): PositionMessage => ({
      ...phone,
      messageId: `trip-${String(second).padStart(12, '0')}`,
      fixTime: at(second),
      receivedAt: at(second),
      latitude: metresNorth(north),
      accuracyM: 5,
      speedKmh: moving ? 36 : 0,
      attributes: { motion: moving, pathDistanceM: path },
    });
    function drive(fixes: PositionMessage[]) {
      let state = evaluatePosition(undefined, fixes[0]!, { geofences: [] }).state;
      const trips: Array<NonNullable<ReturnType<typeof evaluatePosition>['completedTrip']>> = [];
      for (const position of fixes.slice(1)) {
        const next = evaluatePosition(state, position, { geofences: [] });
        if (next.completedTrip) trips.push(next.completedTrip);
        state = next.state;
      }
      return { state, trips };
    }

    it('keeps one trip through a red light, and ends it after five minutes parked', () => {
      const { state, trips } = drive([
        fix(0, 0, false),
        fix(30, 300, true, 300),
        fix(60, 600, true, 300),
        fix(90, 650, false, 50), // red light for 60 s
        fix(150, 650, false, 0),
        fix(180, 950, true, 300),
        fix(210, 1_250, false, 300), // parked
        fix(510, 1_250, false, 0),
        fix(600, 1_250, false, 0),
      ]);
      expect(trips).toHaveLength(1);
      expect(trips[0]).toMatchObject({ startTime: at(30), endTime: at(210) });
      // Every metre counted: the first stretch, the slow-down before each stop, and the odometer
      // agrees with the trip.
      expect(trips[0]!.distanceM).toBeCloseTo(1_250, -1);
      expect(state.odometerM).toBeCloseTo(trips[0]!.distanceM, 0);
    });

    it('counts a car-park shuffle on the odometer but not as a trip', () => {
      const { state, trips } = drive([
        fix(0, 0, false),
        fix(10, 40, true, 40),
        fix(20, 60, false, 20),
        fix(400, 60, false, 0),
      ]);
      expect(trips).toEqual([]);
      expect(state.trip).toBeUndefined();
      expect(state.odometerM).toBeCloseTo(60, 0);
    });

    it('closes the last trip when the vehicle next reports, even after a long gap', () => {
      const { trips, state } = drive([
        fix(0, 0, false),
        fix(30, 400, true, 400),
        fix(60, 500, false, 100), // parked, then the shift ends: nothing for hours
        fix(60 + 6 * 3_600, 500, true, 0), // next morning it drives off
      ]);
      expect(trips).toHaveLength(1);
      expect(trips[0]).toMatchObject({ startTime: at(30), endTime: at(60) });
      expect(state.trip?.startTime).toBe(at(60 + 6 * 3_600));
    });
  });
});

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
    expect(stopped.events.map((event) => event.type)).toEqual(['deviceStopped', 'tripEnded']);
    expect(stopped.completedTrip?.distanceM).toBeGreaterThan(100);
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
});

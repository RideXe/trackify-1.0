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

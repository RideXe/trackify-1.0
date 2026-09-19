import { describe, expect, it } from 'vitest';
import {
  knotsToKmh,
  parseEventMessage,
  parsePositionMessage,
  positionDedupeKey,
  type EventMessageInput,
  type PositionMessageInput,
} from '../src/index';

const TENANT_ID = '01J9ZQ3V5X8K2M4N6P7R8S9T0V';
const DEVICE_ID = '01J9ZQ3W1A2B3C4D5E6F7G8H9J';

function validPosition(overrides: Partial<PositionMessageInput> = {}): PositionMessageInput {
  return {
    v: 1,
    ingestId: 'gw-task-1:000001',
    messageId: 'sha256:0123456789abcdef',
    tenantId: TENANT_ID,
    deviceId: DEVICE_ID,
    uniqueId: '359632101234567',
    protocol: 'gt06',
    source: 'gateway',
    receivedAt: 1_757_836_800_500,
    fixTime: 1_757_836_800_000,
    valid: true,
    latitude: 12.9716,
    longitude: 77.5946,
    speedKmh: 42.5,
    courseDeg: 180,
    ...overrides,
  };
}

describe('position messages', () => {
  it('accepts a valid position and defaults attributes to an empty object', () => {
    const result = parsePositionMessage(validPosition());
    expect(result.success).toBe(true);
    expect(result.data?.attributes).toEqual({});
  });

  it('accepts well-known attributes and protocol-specific io values', () => {
    const result = parsePositionMessage(
      validPosition({
        attributes: {
          ignition: true,
          alarms: ['sos', 'powerCut'],
          batteryLevelPct: 87,
          io: { din1: 1, iccid: '8991000000000000001', immobilizer: false },
        },
      }),
    );
    expect(result.success).toBe(true);
    expect(result.data?.attributes.alarms).toEqual(['sos', 'powerCut']);
  });

  it.each([
    ['latitude above 90', { latitude: 90.0001 }],
    ['latitude below -90', { latitude: -91 }],
    ['longitude above 180', { longitude: 180.5 }],
    ['negative speed', { speedKmh: -1 }],
    ['course above 360', { courseDeg: 361 }],
    ['non-integer fix time', { fixTime: 1.5 }],
  ])('rejects %s', (_label, overrides) => {
    expect(parsePositionMessage(validPosition(overrides)).success).toBe(false);
  });

  it('rejects unknown alarm codes', () => {
    const input = validPosition();
    const result = parsePositionMessage({ ...input, attributes: { alarms: ['selfDestruct'] } });
    expect(result.success).toBe(false);
  });

  it('rejects an unsupported message version', () => {
    expect(parsePositionMessage({ ...validPosition(), v: 2 }).success).toBe(false);
  });

  it('rejects ids that are not ULIDs', () => {
    expect(parsePositionMessage(validPosition({ deviceId: 'device-1' })).success).toBe(false);
  });

  it('strips unknown top-level fields so newer producers do not break older consumers', () => {
    const result = parsePositionMessage({ ...validPosition(), futureField: 'x' });
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty('futureField');
  });

  it('builds a stable de-duplication key without collapsing same-time fixes', () => {
    expect(
      positionDedupeKey({
        deviceId: DEVICE_ID,
        fixTime: 1_757_836_800_000,
        messageId: 'sha256:0123456789abcdef',
      }),
    ).toBe(`${DEVICE_ID}#1757836800000#sha256:0123456789abcdef`);
  });

  it('converts knots to km/h', () => {
    expect(knotsToKmh(10)).toBe(18.52);
    expect(knotsToKmh(0)).toBe(0);
  });
});

describe('event messages (shared contract)', () => {
  function validEvent(overrides: Partial<EventMessageInput> = {}): EventMessageInput {
    return {
      v: 1,
      eventId: '01J9ZQ3X9K8J7H6G5F4E3D2C1B',
      tenantId: TENANT_ID,
      deviceId: DEVICE_ID,
      type: 'ignitionOn',
      eventTime: 1_757_836_800_000,
      ...overrides,
    };
  }

  it('accepts a simple event', () => {
    expect(parseEventMessage(validEvent()).success).toBe(true);
  });

  it('requires the alarm type on alarm events', () => {
    expect(parseEventMessage(validEvent({ type: 'alarm' })).success).toBe(false);
    expect(parseEventMessage(validEvent({ type: 'alarm', alarm: 'sos' })).success).toBe(true);
  });

  it('requires the geofence id on geofence events', () => {
    expect(parseEventMessage(validEvent({ type: 'geofenceEnter' })).success).toBe(false);
    expect(
      parseEventMessage(
        validEvent({ type: 'geofenceExit', geofenceId: '01J9ZQ3Y0A1B2C3D4E5F6G7H8J' }),
      ).success,
    ).toBe(true);
  });
});

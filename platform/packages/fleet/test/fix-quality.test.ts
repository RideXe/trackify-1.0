import { describe, expect, it } from 'vitest';
import type { PositionMessage } from '@trackify/domain';
import { assessFix, evaluatePosition, maxSpeedFor, type FleetState } from '../src/index';

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
  speedKmh: 40,
  attributes: { satellites: 9 },
} satisfies PositionMessage;
const north = (metres: number) => base.latitude + metres / 111_195;
const fix = (
  seconds: number,
  metresNorth: number,
  extra: Partial<PositionMessage> = {},
): PositionMessage => ({
  ...base,
  messageId: `m-${String(seconds).padStart(14, '0')}`,
  fixTime: 1_000 + seconds * 1000,
  latitude: north(metresNorth),
  ...extra,
});
const previous = (seconds: number, metresNorth: number) => ({
  latitude: north(metresNorth),
  longitude: base.longitude,
  fixTime: 1_000 + seconds * 1000,
  speedKmh: 40,
});

describe('server fix quality', () => {
  it('rejects fixes the tracker itself marks as poor', () => {
    expect(assessFix(undefined, fix(0, 0, { attributes: { satellites: 3 } }))).toEqual({
      accept: false,
      reason: 'fewSatellites',
    });
    expect(assessFix(undefined, fix(0, 0, { attributes: { hdop: 7 } }))).toEqual({
      accept: false,
      reason: 'poorHdop',
    });
    expect(assessFix(undefined, fix(0, 0, { accuracyM: 400 }))).toEqual({
      accept: false,
      reason: 'inaccurate',
    });
    expect(assessFix(undefined, fix(0, 0, { valid: false }))).toEqual({
      accept: false,
      reason: 'invalid',
    });
  });

  it('accepts normal driving and rejects a jump faster than the tracker’s own speed', () => {
    expect(assessFix(previous(0, 0), fix(10, 110))).toEqual({ accept: true, relocated: false });
    // 400 m in 10 s (under the top speed) while the tracker measures 40 km/h.
    expect(assessFix(previous(0, 0), fix(10, 400))).toMatchObject({
      accept: false,
      reason: 'speedMismatch',
    });
  });

  it('uses a realistic top speed for the vehicle type', () => {
    expect(maxSpeedFor('bus')).toBe(35);
    expect(maxSpeedFor('car')).toBe(50);
    const noSpeed = { ...previous(0, 0), speedKmh: undefined };
    expect(
      assessFix(noSpeed, fix(10, 450, { speedKmh: undefined }), maxSpeedFor('bus')),
    ).toMatchObject({ reason: 'tooFast' });
    expect(
      assessFix(noSpeed, fix(10, 450, { speedKmh: undefined }), maxSpeedFor('car')),
    ).toMatchObject({ accept: true });
  });

  it('accepts a real jump once following fixes agree with it', () => {
    let state: ReturnType<typeof previous> & {
      suspect?: { latitude: number; longitude: number; fixTime: number; count: number };
    } = previous(0, 0);
    const verdicts = [10, 20, 30].map((seconds, index) => {
      const verdict = assessFix(state, fix(seconds, 5_000 + index * 110));
      if (!verdict.accept) state = { ...state, suspect: verdict.suspect };
      return verdict;
    });
    expect(verdicts.map((verdict) => verdict.accept)).toEqual([false, false, true]);
    expect(verdicts[2]).toEqual({ accept: true, relocated: true });
  });

  it('starts over when the next odd fix disagrees with the previous one', () => {
    const first = assessFix(previous(0, 0), fix(10, 5_000));
    expect(first).toMatchObject({ accept: false, suspect: { count: 1 } });
    const elsewhere = assessFix(
      { ...previous(0, 0), suspect: first.accept ? undefined : first.suspect },
      fix(20, -5_000),
    );
    expect(elsewhere).toMatchObject({ accept: false, suspect: { count: 1 } });
  });
});

describe('distance from a filtered phone', () => {
  const state = (metres: number): FleetState => ({
    fixTime: 1_000,
    latitude: north(metres),
    longitude: base.longitude,
    accuracyM: 3,
    motion: true,
    overspeeding: false,
    geofencesInside: [],
    odometerM: 0,
  });
  const phone = (extra: Partial<PositionMessage['attributes']>) =>
    fix(10, 100, {
      source: 'http',
      protocol: 'osmand',
      accuracyM: 3,
      attributes: { motion: true, ...extra },
    });

  it('uses the phone’s along-track distance when it is plausible', () => {
    // 100 m straight, 118 m along a curve.
    expect(
      evaluatePosition(state(0), phone({ pathDistanceM: 118 }), { geofences: [] }).state.odometerM,
    ).toBe(118);
  });

  it('falls back to the straight line when the reported path is implausible', () => {
    expect(
      evaluatePosition(state(0), phone({ pathDistanceM: 900 }), { geofences: [] }).state.odometerM,
    ).toBeCloseTo(100, 0);
    expect(
      evaluatePosition(state(0), phone({ pathDistanceM: 20 }), { geofences: [] }).state.odometerM,
    ).toBeCloseTo(100, 0);
  });

  it('trusts the phone that it was parked, and adds nothing for a relocation', () => {
    const parked = fix(10, 30, {
      source: 'http',
      accuracyM: 3,
      attributes: { motion: false, pathDistanceM: 0 },
    });
    expect(evaluatePosition(state(0), parked, { geofences: [] }).state.odometerM).toBe(0);
    const jump = evaluatePosition(state(0), fix(10, 5_000), { geofences: [] }, { relocated: true });
    expect(jump.state.odometerM).toBe(0);
  });
});

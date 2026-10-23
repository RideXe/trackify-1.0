import { describe, expect, it } from 'vitest';
import { isFuelType, isVehicleType, toVehicleType, vehicleTypes } from '../src/index';

describe('vehicle types', () => {
  it('lists car first as the default', () => {
    expect(vehicleTypes[0]).toBe('car');
    expect(new Set(vehicleTypes).size).toBe(vehicleTypes.length);
  });

  it('shows devices saved without a known type as cars', () => {
    expect(toVehicleType(undefined)).toBe('car');
    expect(toVehicleType('spaceship')).toBe('car');
    expect(toVehicleType('schoolBus')).toBe('schoolBus');
  });

  it('only accepts listed types', () => {
    expect(isVehicleType('truck')).toBe(true);
    expect(isVehicleType('Truck')).toBe(false);
    expect(isVehicleType(3)).toBe(false);
  });
});

describe('fuel types', () => {
  it('has no default fallback: unrecognized values are simply not a fuel type', () => {
    expect(isFuelType('diesel')).toBe(true);
    expect(isFuelType(undefined)).toBe(false);
    expect(isFuelType('unleaded')).toBe(false);
  });
});

describe('sync interval and plans', async () => {
  const { effectiveTrackerInterval, fastestIntervalFor, trackerIntervals } =
    await import('../src/index');

  it('offers 5 s to 5 min and limits each plan', () => {
    expect(trackerIntervals).toEqual([5, 10, 15, 30, 60, 120, 300]);
    expect([
      fastestIntervalFor('basic'),
      fastestIntervalFor('standard'),
      fastestIntervalFor('premium'),
    ]).toEqual([30, 15, 5]);
    // Fleets from before plans existed keep the 15 s they could already choose.
    expect(fastestIntervalFor(undefined)).toBe(15);
  });

  it('uses the vehicle setting, else the fleet default, else 30 s, never faster than the plan', () => {
    expect(effectiveTrackerInterval({ plan: 'premium' })).toBe(30);
    expect(effectiveTrackerInterval({ fleet: 10, plan: 'premium' })).toBe(10);
    expect(effectiveTrackerInterval({ vehicle: 5, fleet: 60, plan: 'premium' })).toBe(5);
    // After a downgrade, a vehicle set to 5 s slows to the new limit by itself.
    expect(effectiveTrackerInterval({ vehicle: 5, plan: 'basic' })).toBe(30);
    expect(effectiveTrackerInterval({ vehicle: 120, plan: 'basic' })).toBe(120);
  });
});
